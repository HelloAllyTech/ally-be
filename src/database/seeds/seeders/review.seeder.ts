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
import { TENANT_CODE } from '../config';

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
        status: ReviewStatus.IN_REVIEW,
        note: fixture.note ?? null,
        noteEditedAt: fixture.note ? new Date() : null,
        tenantId: TENANT_CODE,
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
          tenantId: TENANT_CODE,
        }),
      );
      threadsCreated++;

      for (const commentFixture of threadFixture.comments) {
        const topLevelId = await createComment(
          commentRepo,
          commentReactionRepo,
          resolveUserId,
          thread.id,
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
          tenantId: TENANT_CODE,
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
  fixture: ReviewCommentFixture | { authorEmail: string; content: string; reactions?: Array<{ email: string; reaction: string }> },
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
      tenantId: TENANT_CODE,
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
        tenantId: TENANT_CODE,
      }),
    );
  }

  return comment.id;
}
