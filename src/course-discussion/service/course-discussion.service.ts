import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { LoggerService } from 'src/logger/logger.service';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { TrackEnrollmentService } from 'src/track/service/track-enrollment.service';
import { User } from 'src/user/entity/user.entity';
import { CourseDiscussion } from '../entity/course-discussion.entity';
import { CourseDiscussionPost } from '../entity/course-discussion-post.entity';
import {
  DiscussionPostDto,
  DiscussionTenantSummaryDto,
  DiscussionViewDto,
} from '../dto/course-discussion.dto';
import {
  COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE,
  DISCUSSION_EDIT_WINDOW_MINUTES,
  DISCUSSION_MAX_DEPTH,
  DISCUSSION_MAX_LENGTH,
} from '../type/course-discussion.constant';

/**
 * Who is asking, about which item, in which organisation's thread. Resolved
 * once per request by `resolveAccess` — every route funnels through it.
 */
interface DiscussionAccess {
  userId: number;
  item: TrackItem;
  /** The organisation whose thread this request reads or writes. */
  tenantId: string;
  /** Holds edit:admin:track — the course-creator powers of R4–R6. */
  canModerate: boolean;
  /** False when a moderator is looking at another organisation's thread. */
  isOwnTenant: boolean;
}

/** Inline discussions on course items — see docs/course-discussions.md. */
@Injectable()
export class CourseDiscussionService {
  private readonly logger = LoggerService.getInstance(
    CourseDiscussionService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly permissionsService: PermissionsService,
    private readonly trackEnrollmentService: TrackEnrollmentService,
    private readonly inAppNotificationService: InAppNotificationService,
  ) {}

  private get discussionRepo() {
    return this.dataSource.getRepository(CourseDiscussion);
  }

  private get postRepo() {
    return this.dataSource.getRepository(CourseDiscussionPost);
  }

  /* ---------------------------------------------------------------- *
   * Reads
   * ---------------------------------------------------------------- */

  async getDiscussion(
    trackItemId: string,
    tenantOverride?: string,
  ): Promise<DiscussionViewDto> {
    const access = await this.resolveAccess(trackItemId, tenantOverride);
    const discussion = await this.discussionRepo.findOne({
      where: { trackItemId, tenantId: access.tenantId },
    });
    const enabled = access.item.hasDiscussion;
    const isLocked = discussion?.isLocked ?? false;

    const posts =
      enabled && discussion
        ? await this.postRepo.find({
            where: { discussionId: discussion.id, deletedAt: IsNull() },
            order: { createdAt: 'ASC' },
          })
        : [];
    const authors = await this.loadAuthors(posts);

    return {
      trackId: access.item.trackId,
      trackItemId,
      tenantId: access.tenantId,
      enabled,
      isLocked,
      postCount: posts.filter((post) => !post.isDeletedByAuthor).length,
      viewer: {
        userId: access.userId,
        canModerate: access.canModerate,
        canPost: enabled && !isLocked && access.isOwnTenant,
        maxDepth: DISCUSSION_MAX_DEPTH,
        maxLength: DISCUSSION_MAX_LENGTH,
        editWindowMinutes: DISCUSSION_EDIT_WINDOW_MINUTES,
      },
      posts: this.buildTree(posts, authors, access, isLocked),
    };
  }

  /** Moderators: which organisations have a thread on this item. */
  async listTenantsWithPosts(
    trackItemId: string,
  ): Promise<DiscussionTenantSummaryDto[]> {
    const access = await this.resolveAccess(trackItemId);
    if (!access.canModerate) {
      throw new ForbiddenException('Only course editors can moderate.');
    }
    const rows: {
      tenantId: string;
      tenantName: string | null;
      postCount: string;
      isLocked: boolean;
      lastPostAt: Date | null;
    }[] = await this.dataSource.query(
      `SELECT d.tenant_id AS "tenantId",
              t.name AS "tenantName",
              COUNT(p.id) FILTER (WHERE NOT p."isDeletedByAuthor") AS "postCount",
              d."isLocked" AS "isLocked",
              MAX(p."createdAt") AS "lastPostAt"
         FROM course_discussions d
         LEFT JOIN tenants t ON t.id::text = d.tenant_id
         LEFT JOIN course_discussion_posts p
           ON p."discussionId" = d.id AND p."deletedAt" IS NULL
        WHERE d."trackItemId" = $1
        GROUP BY d.id, t.name
        ORDER BY MAX(p."createdAt") DESC NULLS LAST`,
      [trackItemId],
    );
    return rows.map((row) => ({
      tenantId: row.tenantId,
      tenantName: row.tenantName ?? row.tenantId,
      postCount: Number(row.postCount),
      isLocked: row.isLocked,
      lastPostAt: row.lastPostAt
        ? new Date(row.lastPostAt).toISOString()
        : null,
    }));
  }

  /* ---------------------------------------------------------------- *
   * Writes
   * ---------------------------------------------------------------- */

  async createPost(
    trackItemId: string,
    content: string,
  ): Promise<DiscussionPostDto> {
    const access = await this.resolveAccess(trackItemId);
    this.assertEnabled(access.item);
    const discussion = await this.findOrCreateDiscussion(access);
    if (discussion.isLocked) {
      throw new ForbiddenException('This discussion is locked.');
    }
    const post = await this.postRepo.save(
      this.postRepo.create({
        tenantId: access.tenantId,
        discussionId: discussion.id,
        trackItemId,
        authorId: access.userId,
        parentPostId: null,
        rootPostId: null,
        depth: 1,
        content: this.normaliseContent(content),
      }),
    );
    return this.toSinglePostDto(post, access, discussion.isLocked);
  }

  async reply(postId: string, content: string): Promise<DiscussionPostDto> {
    const {
      post: parent,
      access,
      discussion,
    } = await this.loadPostForAction(postId);
    if (!access.isOwnTenant) {
      throw new ForbiddenException(
        "You can only post in your own organisation's discussion.",
      );
    }
    this.assertEnabled(access.item);
    if (discussion.isLocked) {
      throw new ForbiddenException('This discussion is locked.');
    }
    if (await this.isThreadLocked(parent)) {
      throw new ForbiddenException('This thread is locked.');
    }
    if (parent.depth >= DISCUSSION_MAX_DEPTH) {
      throw new BadRequestException(
        'Replies can only be nested three levels deep.',
      );
    }

    const reply = await this.postRepo.save(
      this.postRepo.create({
        tenantId: parent.tenantId,
        discussionId: parent.discussionId,
        trackItemId: parent.trackItemId,
        authorId: access.userId,
        parentPostId: parent.id,
        rootPostId: parent.rootPostId ?? parent.id,
        depth: parent.depth + 1,
        content: this.normaliseContent(content),
      }),
    );
    await this.notifyReply(parent, reply, access);
    return this.toSinglePostDto(reply, access, discussion.isLocked);
  }

  async editPost(postId: string, content: string): Promise<DiscussionPostDto> {
    const { post, access, discussion } = await this.loadPostForAction(postId);
    if (post.isDeletedByAuthor) {
      throw new BadRequestException('A deleted post cannot be edited.');
    }
    if (!access.canModerate) {
      if (post.authorId !== access.userId) {
        throw new ForbiddenException('You can only edit your own posts.');
      }
      if (discussion.isLocked || (await this.isThreadLocked(post))) {
        throw new ForbiddenException('This discussion is locked.');
      }
      if (Date.now() > this.editableUntil(post).getTime()) {
        throw new ForbiddenException(
          `Posts can only be edited within ${DISCUSSION_EDIT_WINDOW_MINUTES} minutes of posting.`,
        );
      }
    }

    const normalised = this.normaliseContent(content);
    if (normalised !== post.content) {
      post.content = normalised;
      post.isEdited = true;
      post.editedAt = new Date();
      post.editedById = access.userId;
      await this.postRepo.save(post);
    }
    return this.toSinglePostDto(post, access, discussion.isLocked);
  }

  /**
   * Moderator: the post and everything beneath it go (R4). Author: a post that
   * still has replies becomes a "[deleted by author]" placeholder so the
   * replies keep their context; one without replies is removed, and so is any
   * placeholder left with nothing under it (R8).
   */
  async deletePost(postId: string): Promise<{ success: true }> {
    const { post, access } = await this.loadPostForAction(postId);

    if (access.canModerate) {
      const ids = await this.subtreeIds(post);
      await this.postRepo.update(
        { id: In(ids) },
        { deletedAt: new Date(), deletedById: access.userId },
      );
      await this.prunePlaceholders(post.parentPostId ?? null, access.userId);
      return { success: true };
    }

    if (post.authorId !== access.userId) {
      throw new ForbiddenException('You can only delete your own posts.');
    }
    if (post.isDeletedByAuthor) {
      return { success: true };
    }
    const liveChildren = await this.postRepo.count({
      where: { parentPostId: post.id, deletedAt: IsNull() },
    });
    if (liveChildren > 0) {
      await this.postRepo.update(post.id, {
        isDeletedByAuthor: true,
        content: '',
        deletedById: access.userId,
      });
    } else {
      await this.postRepo.update(post.id, {
        deletedAt: new Date(),
        deletedById: access.userId,
      });
      await this.prunePlaceholders(post.parentPostId ?? null, access.userId);
    }
    return { success: true };
  }

  /** Moderator: stop replies under one top-level post (R6). */
  async setThreadLock(
    postId: string,
    locked: boolean,
  ): Promise<DiscussionPostDto> {
    const { post, access, discussion } = await this.loadPostForAction(postId);
    this.assertModerator(access);
    if (post.depth !== 1) {
      throw new BadRequestException('Only a top-level post can be locked.');
    }
    post.isLocked = locked;
    await this.postRepo.save(post);
    return this.toSinglePostDto(post, access, discussion.isLocked);
  }

  /** Moderator: stop new posts and replies anywhere on the item. */
  async setDiscussionLock(
    trackItemId: string,
    locked: boolean,
    tenantOverride?: string,
  ): Promise<{ success: true }> {
    const access = await this.resolveAccess(trackItemId, tenantOverride);
    this.assertModerator(access);
    const discussion = await this.findOrCreateDiscussion(access);
    await this.discussionRepo.update(discussion.id, {
      isLocked: locked,
      lockedById: locked ? access.userId : null,
      lockedAt: locked ? new Date() : null,
    });
    return { success: true };
  }

  /* ---------------------------------------------------------------- *
   * Access
   * ---------------------------------------------------------------- */

  /**
   * Moderators need no enrolment and may name another organisation. Everyone
   * else must be able to open the item — enrolled, item not LOCKED — which is
   * the same gate every learner item route uses, and always reads their own
   * organisation's thread.
   */
  private async resolveAccess(
    trackItemId: string,
    tenantOverride?: string,
  ): Promise<DiscussionAccess> {
    const userId = Number(ExecutionManager.getUserId());
    const ownTenantId = ExecutionManager.getTenantId();
    if (!userId || !ownTenantId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    const item = await this.dataSource
      .getRepository(TrackItem)
      .findOne({ where: { id: trackItemId } });
    if (!item) {
      throw new NotFoundException('Course item not found');
    }

    const permissions =
      await this.permissionsService.getUserPermissions(userId);
    const canModerate = permissions.includes(PERMISSIONS.EDIT_ADMIN_TRACK);
    if (!canModerate) {
      await this.trackEnrollmentService.getPermittedItemProgress(trackItemId);
    }

    const tenantId =
      canModerate && tenantOverride ? tenantOverride : ownTenantId;
    return {
      userId,
      item,
      tenantId,
      canModerate,
      isOwnTenant: tenantId === ownTenantId,
    };
  }

  /**
   * A post in another organisation reads as not-found to a non-moderator, so
   * its existence is not confirmed across the boundary.
   */
  private async loadPostForAction(postId: string): Promise<{
    post: CourseDiscussionPost;
    access: DiscussionAccess;
    discussion: CourseDiscussion;
  }> {
    const post = await this.postRepo.findOne({
      where: { id: postId, deletedAt: IsNull() },
    });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    const access = await this.resolveAccess(post.trackItemId, post.tenantId);
    if (access.tenantId !== post.tenantId) {
      throw new NotFoundException('Post not found');
    }
    const discussion = await this.discussionRepo.findOneOrFail({
      where: { id: post.discussionId },
    });
    return { post, access, discussion };
  }

  private assertModerator(access: DiscussionAccess): void {
    if (!access.canModerate) {
      throw new ForbiddenException('Only course editors can lock discussions.');
    }
  }

  private assertEnabled(item: TrackItem): void {
    if (!item.hasDiscussion) {
      throw new ForbiddenException(
        'Discussion is turned off for this course item.',
      );
    }
  }

  /* ---------------------------------------------------------------- *
   * Helpers
   * ---------------------------------------------------------------- */

  /** Tolerates the race where two first posts arrive at once. */
  private async findOrCreateDiscussion(
    access: DiscussionAccess,
  ): Promise<CourseDiscussion> {
    const where = {
      trackItemId: access.item.id,
      tenantId: access.tenantId,
    };
    const existing = await this.discussionRepo.findOne({ where });
    if (existing) return existing;
    await this.discussionRepo
      .createQueryBuilder()
      .insert()
      .values({
        ...where,
        trackId: access.item.trackId,
        createdById: access.userId,
      })
      .orIgnore()
      .execute();
    return this.discussionRepo.findOneOrFail({ where });
  }

  private normaliseContent(content: string): string {
    const trimmed = (content ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Write something before posting.');
    }
    if (trimmed.length > DISCUSSION_MAX_LENGTH) {
      throw new BadRequestException(
        `Posts can be at most ${DISCUSSION_MAX_LENGTH} characters.`,
      );
    }
    return trimmed;
  }

  private editableUntil(post: CourseDiscussionPost): Date {
    return new Date(
      post.createdAt.getTime() + DISCUSSION_EDIT_WINDOW_MINUTES * 60_000,
    );
  }

  private async isThreadLocked(post: CourseDiscussionPost): Promise<boolean> {
    if (post.depth === 1) return post.isLocked;
    const root = await this.postRepo.findOne({
      where: { id: post.rootPostId! },
      withDeleted: true,
    });
    return root?.isLocked ?? false;
  }

  private async subtreeIds(post: CourseDiscussionPost): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM course_discussion_posts WHERE id = $1
         UNION ALL
         SELECT p.id FROM course_discussion_posts p
           JOIN subtree s ON p."parentPostId" = s.id
          WHERE p."deletedAt" IS NULL
       )
       SELECT id FROM subtree`,
      [post.id],
    );
    return rows.map((row) => row.id);
  }

  /** Walk up removing "[deleted by author]" placeholders left with no replies. */
  private async prunePlaceholders(
    postId: string | null,
    actorId: number,
  ): Promise<void> {
    let currentId = postId;
    while (currentId) {
      const current = await this.postRepo.findOne({
        where: { id: currentId, deletedAt: IsNull() },
      });
      if (!current?.isDeletedByAuthor) return;
      const liveChildren = await this.postRepo.count({
        where: { parentPostId: current.id, deletedAt: IsNull() },
      });
      if (liveChildren > 0) return;
      await this.postRepo.update(current.id, {
        deletedAt: new Date(),
        deletedById: actorId,
      });
      currentId = current.parentPostId ?? null;
    }
  }

  private async loadAuthors(
    posts: CourseDiscussionPost[],
  ): Promise<Map<number, User>> {
    const ids = [...new Set(posts.map((post) => post.authorId))];
    if (!ids.length) return new Map();
    const users = await this.dataSource.getRepository(User).find({
      where: { id: In(ids) },
      select: { id: true, name: true, profileImageUrl: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  /** Top-level newest first; replies oldest first, so a thread reads down. */
  private buildTree(
    posts: CourseDiscussionPost[],
    authors: Map<number, User>,
    access: DiscussionAccess,
    discussionLocked: boolean,
  ): DiscussionPostDto[] {
    const byParent = new Map<string | null, CourseDiscussionPost[]>();
    for (const post of posts) {
      const key = post.parentPostId ?? null;
      byParent.set(key, [...(byParent.get(key) ?? []), post]);
    }
    const build = (
      post: CourseDiscussionPost,
      threadLocked: boolean,
    ): DiscussionPostDto => {
      const locked = post.depth === 1 ? post.isLocked : threadLocked;
      return {
        ...this.toPostDto(post, authors, access, discussionLocked, locked),
        replies: (byParent.get(post.id) ?? []).map((child) =>
          build(child, locked),
        ),
      };
    };
    return (byParent.get(null) ?? [])
      .slice()
      .reverse()
      .map((post) => build(post, post.isLocked));
  }

  private async toSinglePostDto(
    post: CourseDiscussionPost,
    access: DiscussionAccess,
    discussionLocked: boolean,
  ): Promise<DiscussionPostDto> {
    const authors = await this.loadAuthors([post]);
    const threadLocked = await this.isThreadLocked(post);
    return {
      ...this.toPostDto(post, authors, access, discussionLocked, threadLocked),
      replies: [],
    };
  }

  private toPostDto(
    post: CourseDiscussionPost,
    authors: Map<number, User>,
    access: DiscussionAccess,
    discussionLocked: boolean,
    threadLocked: boolean,
  ): Omit<DiscussionPostDto, 'replies'> {
    const isOwn = post.authorId === access.userId;
    const deleted = post.isDeletedByAuthor;
    const frozen = discussionLocked || threadLocked;
    const editableUntil = this.editableUntil(post);
    const author = authors.get(post.authorId);
    return {
      id: post.id,
      parentPostId: post.parentPostId ?? null,
      depth: post.depth,
      author:
        deleted || !author
          ? null
          : {
              id: author.id,
              name: author.name,
              profileImageUrl: author.profileImageUrl ?? null,
            },
      content: deleted ? null : post.content,
      isDeletedByAuthor: deleted,
      isEdited: post.isEdited,
      editedByModerator:
        post.isEdited && post.editedById != null
          ? post.editedById !== post.authorId
          : false,
      isLocked: threadLocked,
      isOwn,
      createdAt: post.createdAt.toISOString(),
      editedAt: post.editedAt ? post.editedAt.toISOString() : null,
      editableUntil: isOwn && !deleted ? editableUntil.toISOString() : null,
      canEdit:
        !deleted &&
        (access.canModerate ||
          (isOwn && !frozen && Date.now() <= editableUntil.getTime())),
      canDelete: !deleted && (access.canModerate || isOwn),
      canReply:
        access.item.hasDiscussion &&
        access.isOwnTenant &&
        !frozen &&
        post.depth < DISCUSSION_MAX_DEPTH,
      canLock: access.canModerate && post.depth === 1,
    };
  }

  /**
   * R9. The parent's author only, never for replying to yourself or to a
   * placeholder. Best-effort: a failed notification never fails the reply.
   */
  private async notifyReply(
    parent: CourseDiscussionPost,
    reply: CourseDiscussionPost,
    access: DiscussionAccess,
  ): Promise<void> {
    if (parent.authorId === access.userId || parent.isDeletedByAuthor) return;
    try {
      const replier = await this.dataSource
        .getRepository(User)
        .findOne({ where: { id: access.userId }, select: { name: true } });
      const firstName = replier?.name?.trim().split(/\s+/)[0] || 'Someone';
      await this.inAppNotificationService.create({
        userId: parent.authorId,
        tenantId: parent.tenantId,
        type: COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE,
        title: 'New reply to your post',
        body: `${firstName} replied to your post in "${access.item.title}"`,
        data: {
          screen: 'CourseDiscussion',
          trackId: access.item.trackId,
          itemId: access.item.id,
          postId: reply.id,
        },
      });
    } catch (err) {
      this.logger.error(
        `Reply notification failed for post ${reply.id}: ${(err as Error).message}`,
      );
    }
  }
}
