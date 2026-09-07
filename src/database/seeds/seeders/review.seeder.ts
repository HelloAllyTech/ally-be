import { DataSource } from 'typeorm';
import { ScenarioSessions } from '../../../learn/entity/scenario-sessions.entity';
import { ScenarioSessionMessages } from '../../../learn/entity/scenario-session-messages.entity';
import { ScenarioSessionReview } from '../../../scenario-session-review/entity/review.entity';
import { ScenarioSessionReviewThread } from '../../../scenario-session-review/entity/thread.entity';
import { ScenarioSessionReviewComment } from '../../../scenario-session-review/entity/comment.entity';
import { ScenarioSessionReviewReaction } from '../../../scenario-session-review/entity/reaction.entity';
import { ScenarioSessionReviewCommentReaction } from '../../../scenario-session-review/entity/comment-reaction.entity';
import { ScenarioSessionReviewReadStatus } from '../../../scenario-session-review/entity/read-status.entity';
import { User } from '../../../user/entity/user.entity';
import { ReviewStatus } from '../../../review/type/review.type';
import { getRepo, log } from '../helpers';
import { reviews, ReviewCommentFixture } from '../fixtures';

/**
 * One-time repair: every review/thread/comment/reaction row written before
 * this fix hardcoded tenantId to the literal string 'ally' (the tenant
 * *code*) instead of the session's actual tenant *UUID* — every tenant-scoped
 * query compares against the UUID, so this made every seeded review
 * invisible everywhere, including in the 'ally' tenant itself. 'ally' can
 * never be a legitimate UUID, so this predicate can't misfire against a
 * correctly-tenanted row.
 */
async function repairMistenantedReviews(ds: DataSource): Promise<number> {
  const BAD_TENANT_ID = 'ally';
  const result = await ds.query(
    `
    UPDATE "scenario_session_reviews" r
    SET "tenant_id" = s."tenant_id"
    FROM "scenario_sessions" s
    WHERE s.id = r."scenarioSessionId" AND r."tenant_id" = $1
    `,
    [BAD_TENANT_ID],
  );
  const reviewsRepaired = result[1] ?? 0;

  await ds.query(
    `
    UPDATE "scenario_session_review_threads" t
    SET "tenant_id" = r."tenant_id"
    FROM "scenario_session_reviews" r
    WHERE r.id = t."reviewId" AND t."tenant_id" = $1
    `,
    [BAD_TENANT_ID],
  );
  await ds.query(
    `
    UPDATE "scenario_session_review_comments" c
    SET "tenant_id" = t."tenant_id"
    FROM "scenario_session_review_threads" t
    WHERE t.id = c."reviewThreadId" AND c."tenant_id" = $1
    `,
    [BAD_TENANT_ID],
  );
  await ds.query(
    `
    UPDATE "scenario_session_review_reactions" rx
    SET "tenant_id" = r."tenant_id"
    FROM "scenario_session_reviews" r
    WHERE r.id = rx."reviewId" AND rx."tenant_id" = $1
    `,
    [BAD_TENANT_ID],
  );
  await ds.query(
    `
    UPDATE "scenario_session_review_comment_reactions" cr
    SET "tenant_id" = c."tenant_id"
    FROM "scenario_session_review_comments" c
    WHERE c.id = cr."reviewCommentId" AND cr."tenant_id" = $1
    `,
    [BAD_TENANT_ID],
  );

  return reviewsRepaired;
}

export async function seedReviews(ds: DataSource): Promise<void> {
  const sessionRepo = getRepo(ds, ScenarioSessions);
  const messageRepo = getRepo(ds, ScenarioSessionMessages);
  const reviewRepo = getRepo(ds, ScenarioSessionReview);
  const threadRepo = getRepo(ds, ScenarioSessionReviewThread);
  const commentRepo = getRepo(ds, ScenarioSessionReviewComment);
  const reactionRepo = getRepo(ds, ScenarioSessionReviewReaction);
  const commentReactionRepo = getRepo(ds, ScenarioSessionReviewCommentReaction);
  const readStatusRepo = getRepo(ds, ScenarioSessionReviewReadStatus);
  const userRepo = getRepo(ds, User);

  const reviewsRepaired = await repairMistenantedReviews(ds);
  log(`reviews: repaired ${reviewsRepaired} mis-tenanted row(s)`);

  const allUsers = await userRepo.find();
  const userIdByEmail = new Map(allUsers.map((u) => [u.email, u.id]));

  const resolveUserId = (email: string): number | undefined =>
    userIdByEmail.get(email);

  let reviewsCreated = 0;
  let reviewsSkipped = 0;
  let threadsCreated = 0;
  let commentsCreated = 0;
  let reactionsCreated = 0;
  let readsCreated = 0;

  for (const fixture of reviews) {
    const session = await sessionRepo.findOne({
      where: { roomId: fixture.sessionRoomId },
    });
    if (!session) {
      log(`session ${fixture.sessionRoomId} missing — skipping review`);
      continue;
    }

    const authorId = resolveUserId(fixture.authorEmail);
    if (!authorId) {
      log(`review author ${fixture.authorEmail} missing — skipping`);
      continue;
    }

    const existing = await reviewRepo.findOne({
      where: { scenarioSessionId: session.id },
    });
    if (existing) {
      reviewsSkipped++;
      continue;
    }

    const review = await reviewRepo.save(
      reviewRepo.create({
        scenarioSessionId: session.id,
        createdBy: authorId,
        status: fixture.status ?? ReviewStatus.IN_REVIEW,
        note: fixture.note ?? null,
        noteEditedAt: fixture.note ? new Date() : null,
        tenantId: session.tenantId,
      }),
    );
    reviewsCreated++;

    // Resolve transcript messages once per review, ordered by id ASC to match
    // the turn order the session seeder inserted them in.
    const messages = await messageRepo.find({
      where: { scenarioSessionId: session.id },
      order: { id: 'ASC' },
    });

    for (const threadFixture of fixture.threads) {
      const threadAuthorId = resolveUserId(threadFixture.authorEmail);
      if (!threadAuthorId) continue;

      let messageId: number | undefined;
      let selection: Record<string, any> | undefined;
      if (threadFixture.turnIndex !== 'general') {
        const message = messages[threadFixture.turnIndex];
        if (!message) continue;
        messageId = message.id;
        selection = threadFixture.selection;
      }

      const thread = await threadRepo.save(
        threadRepo.create({
          reviewId: review.id,
          messageId,
          selection,
          createdBy: threadAuthorId,
          tenantId: review.tenantId,
        }),
      );
      threadsCreated++;

      for (const commentFixture of threadFixture.comments) {
        const topLevelId = await createComment(
          commentRepo,
          commentReactionRepo,
          resolveUserId,
          thread.id,
          thread.tenantId,
          commentFixture,
          undefined,
        );
        if (!topLevelId) continue;
        commentsCreated++;
        reactionsCreated += commentFixture.reactions?.length ?? 0;

        for (const reply of commentFixture.replies ?? []) {
          const replyId = await createComment(
            commentRepo,
            commentReactionRepo,
            resolveUserId,
            thread.id,
            thread.tenantId,
            reply,
            topLevelId,
          );
          if (!replyId) continue;
          commentsCreated++;
          reactionsCreated += reply.reactions?.length ?? 0;
        }
      }
    }

    for (const reaction of fixture.reactions ?? []) {
      const reactorId = resolveUserId(reaction.email);
      if (!reactorId) continue;
      await reactionRepo.save(
        reactionRepo.create({
          reviewId: review.id,
          reaction: reaction.reaction,
          createdBy: reactorId,
          tenantId: review.tenantId,
        }),
      );
      reactionsCreated++;
    }

    for (const email of fixture.readByEmails ?? []) {
      const readerId = resolveUserId(email);
      if (!readerId) continue;
      await readStatusRepo.save(
        readStatusRepo.create({
          userId: readerId,
          reviewId: review.id,
          readAt: new Date(),
        }),
      );
      readsCreated++;
    }
  }

  log(
    `reviews: ${reviewsCreated} created, ${reviewsSkipped} already existed ` +
      `(${threadsCreated} threads, ${commentsCreated} comments, ` +
      `${reactionsCreated} reactions, ${readsCreated} read receipts)`,
  );
}

async function createComment(
  commentRepo: ReturnType<typeof getRepo<ScenarioSessionReviewComment>>,
  commentReactionRepo: ReturnType<
    typeof getRepo<ScenarioSessionReviewCommentReaction>
  >,
  resolveUserId: (email: string) => number | undefined,
  threadId: string,
  tenantId: string,
  fixture:
    | ReviewCommentFixture
    | {
        authorEmail: string;
        content: string;
        reactions?: Array<{ email: string; reaction: string }>;
      },
  parentCommentId: string | undefined,
): Promise<string | undefined> {
  const authorId = resolveUserId(fixture.authorEmail);
  if (!authorId) return undefined;

  const comment = await commentRepo.save(
    commentRepo.create({
      reviewThreadId: threadId,
      content: fixture.content,
      createdBy: authorId,
      parentCommentId,
      hidden: 'hidden' in fixture ? (fixture.hidden ?? false) : false,
      tenantId,
    }),
  );

  for (const reaction of fixture.reactions ?? []) {
    const reactorId = resolveUserId(reaction.email);
    if (!reactorId) continue;
    await commentReactionRepo.save(
      commentReactionRepo.create({
        reviewCommentId: comment.id,
        reaction: reaction.reaction,
        createdBy: reactorId,
        tenantId,
      }),
    );
  }

  return comment.id;
}
