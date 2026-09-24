import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { TrackItem } from 'src/track/entity/track-item.entity';
import { User } from 'src/user/entity/user.entity';
import { CourseDiscussion } from '../../entity/course-discussion.entity';
import { CourseDiscussionPost } from '../../entity/course-discussion-post.entity';
import { CourseDiscussionService } from '../course-discussion.service';
import { COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE } from '../../type/course-discussion.constant';

/**
 * Runs the service against a small in-memory stand-in for the four tables it
 * touches, so the threading, deletion and permission rules are exercised end
 * to end rather than mock-by-mock.
 */

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected instanceof FindOperator) {
      if (expected.type === 'isNull') return row[key] == null;
      if (expected.type === 'in')
        return (expected.value as unknown[]).includes(row[key]);
      throw new Error(`unsupported operator ${expected.type}`);
    }
    return row[key] === expected;
  });
}

let idSeq = 0;
function fakeRepo(rows: Row[], defaults: () => Row = () => ({})) {
  return {
    rows,
    create: (data: Row) => ({ ...defaults(), ...data }),
    findOne: async ({ where }: { where: Row }) =>
      rows.find((row) => matches(row, where)) ?? null,
    findOneOrFail: async ({ where }: { where: Row }) => {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) throw new Error('not found');
      return row;
    },
    find: async ({ where }: { where: Row }) =>
      rows
        .filter((row) => matches(row, where))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)),
    count: async ({ where }: { where: Row }) =>
      rows.filter((row) => matches(row, where)).length,
    save: async (data: Row) => {
      const existing = data.id && rows.find((row) => row.id === data.id);
      if (existing) return Object.assign(existing, data);
      const row = {
        id: `id-${++idSeq}`,
        createdAt: new Date(Date.now() + idSeq),
        ...data,
      };
      rows.push(row);
      return row;
    },
    update: async (criteria: string | Row, patch: Row) => {
      const where = typeof criteria === 'string' ? { id: criteria } : criteria;
      rows
        .filter((row) => matches(row, where))
        .forEach((row) => Object.assign(row, patch));
      return { affected: 1 };
    },
    createQueryBuilder: () => {
      let values: Row = {};
      const builder = {
        insert: () => builder,
        values: (data: Row) => ((values = data), builder),
        orIgnore: () => builder,
        execute: async () => {
          rows.push({ id: `id-${++idSeq}`, isLocked: false, ...values });
        },
      };
      return builder;
    },
  };
}

const LEARNER_A = 1;
const LEARNER_B = 2;
const EDITOR = 9;
const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';

describe('CourseDiscussionService', () => {
  let item: Row;
  let discussions: ReturnType<typeof fakeRepo>;
  let posts: ReturnType<typeof fakeRepo>;
  let permissions: Record<number, string[]>;
  let getPermittedItemProgress: jest.Mock;
  let createNotification: jest.Mock;
  let service: CourseDiscussionService;
  let currentUser: number;
  let currentTenant: string;

  const as = (userId: number, tenantId = TENANT) => {
    currentUser = userId;
    currentTenant = tenantId;
  };

  beforeEach(() => {
    idSeq = 0;
    item = {
      id: 'item-1',
      trackId: 'track-1',
      title: 'Active listening',
      hasDiscussion: true,
    };
    discussions = fakeRepo([]);
    posts = fakeRepo([], () => ({
      isEdited: false,
      isDeletedByAuthor: false,
      isLocked: false,
      deletedAt: null,
      editedAt: null,
      editedById: null,
    }));
    const users = fakeRepo([
      { id: LEARNER_A, name: 'Asha Kumar', profileImageUrl: null },
      { id: LEARNER_B, name: 'Ben Ode', profileImageUrl: null },
      { id: EDITOR, name: 'Course Editor', profileImageUrl: null },
    ]);
    const items = fakeRepo([item]);
    const repos = new Map<unknown, unknown>([
      [CourseDiscussion, discussions],
      [CourseDiscussionPost, posts],
      [User, users],
      [TrackItem, items],
    ]);
    const dataSource = {
      getRepository: (entity: unknown) => repos.get(entity),
      query: async (sql: string, params: unknown[]) => {
        if (sql.includes('WITH RECURSIVE')) {
          const ids = [params[0] as string];
          for (let i = 0; i < ids.length; i++) {
            posts.rows
              .filter((row) => row.parentPostId === ids[i] && !row.deletedAt)
              .forEach((row) => ids.push(row.id));
          }
          return ids.map((id) => ({ id }));
        }
        throw new Error(`unexpected query ${sql}`);
      },
    };

    permissions = {
      [LEARNER_A]: [PERMISSIONS.VIEW_TRACK, PERMISSIONS.EDIT_TRACK],
      [LEARNER_B]: [PERMISSIONS.VIEW_TRACK, PERMISSIONS.EDIT_TRACK],
      [EDITOR]: [PERMISSIONS.EDIT_ADMIN_TRACK],
    };
    getPermittedItemProgress = jest.fn().mockResolvedValue({});
    createNotification = jest.fn().mockResolvedValue({});

    service = new CourseDiscussionService(
      dataSource as any,
      {
        getUserPermissions: async (id: number) => permissions[id] ?? [],
      } as any,
      { getPermittedItemProgress } as any,
      { create: createNotification } as any,
    );

    as(LEARNER_A);
    jest
      .spyOn(ExecutionManager, 'getUserId')
      .mockImplementation(() => String(currentUser));
    jest
      .spyOn(ExecutionManager, 'getTenantId')
      .mockImplementation(() => currentTenant);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('reading', () => {
    it('shows every post without the reader having posted (R1)', async () => {
      await service.createPost('item-1', 'First thought');
      as(LEARNER_B);
      const view = await service.getDiscussion('item-1');
      expect(view.posts).toHaveLength(1);
      expect(view.posts[0].content).toBe('First thought');
      expect(view.posts[0].author?.name).toBe('Asha Kumar');
      expect(view.viewer.canPost).toBe(true);
    });

    it('requires a learner to be able to open the item', async () => {
      getPermittedItemProgress.mockRejectedValueOnce(
        new ForbiddenException('You are not enrolled in this track'),
      );
      await expect(service.getDiscussion('item-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets a course editor read without enrolling', async () => {
      as(EDITOR);
      await service.getDiscussion('item-1');
      expect(getPermittedItemProgress).not.toHaveBeenCalled();
    });

    it("keeps each organisation's thread separate", async () => {
      await service.createPost('item-1', 'Org A thought');
      as(LEARNER_B, OTHER_TENANT);
      const view = await service.getDiscussion('item-1');
      expect(view.posts).toHaveLength(0);
    });

    it("ignores a learner's tenantId override", async () => {
      await service.createPost('item-1', 'Org A thought');
      as(LEARNER_B, OTHER_TENANT);
      const view = await service.getDiscussion('item-1', TENANT);
      expect(view.tenantId).toBe(OTHER_TENANT);
      expect(view.posts).toHaveLength(0);
    });

    it("lets a moderator read another organisation's thread, read-only for posting", async () => {
      await service.createPost('item-1', 'Org A thought');
      as(EDITOR, OTHER_TENANT);
      const view = await service.getDiscussion('item-1', TENANT);
      expect(view.posts).toHaveLength(1);
      expect(view.viewer.canPost).toBe(false);
      expect(view.posts[0].canReply).toBe(false);
      expect(view.posts[0].canDelete).toBe(true);
    });

    it('hides posts, without deleting them, when discussion is turned off', async () => {
      await service.createPost('item-1', 'Kept');
      item.hasDiscussion = false;
      const view = await service.getDiscussion('item-1');
      expect(view.enabled).toBe(false);
      expect(view.posts).toEqual([]);
      expect(posts.rows).toHaveLength(1);
    });

    it('orders top-level posts newest first and replies oldest first', async () => {
      const first = await service.createPost('item-1', 'one');
      await service.createPost('item-1', 'two');
      await service.reply(first.id, 'reply a');
      await service.reply(first.id, 'reply b');
      const view = await service.getDiscussion('item-1');
      expect(view.posts.map((post) => post.content)).toEqual(['two', 'one']);
      expect(view.posts[1].replies.map((post) => post.content)).toEqual([
        'reply a',
        'reply b',
      ]);
    });
  });

  describe('posting and replying', () => {
    it('rejects posts when discussion is turned off', async () => {
      item.hasDiscussion = false;
      await expect(service.createPost('item-1', 'hi')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects empty content', async () => {
      await expect(service.createPost('item-1', '   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('threads replies up to three levels and no further (R3)', async () => {
      const post = await service.createPost('item-1', 'level 1');
      const reply = await service.reply(post.id, 'level 2');
      const nested = await service.reply(reply.id, 'level 3');
      expect(nested.depth).toBe(3);
      expect(nested.canReply).toBe(false);
      await expect(service.reply(nested.id, 'level 4')).rejects.toThrow(
        BadRequestException,
      );
      const view = await service.getDiscussion('item-1');
      expect(view.posts[0].replies[0].replies[0].content).toBe('level 3');
    });

    it('notifies the parent author of a reply (R9)', async () => {
      const post = await service.createPost('item-1', 'thought');
      as(LEARNER_B);
      const reply = await service.reply(post.id, 'agreed');
      expect(createNotification).toHaveBeenCalledWith({
        userId: LEARNER_A,
        tenantId: TENANT,
        type: COURSE_DISCUSSION_REPLY_NOTIFICATION_TYPE,
        title: 'New reply to your post',
        body: 'Ben replied to your post in "Active listening"',
        data: {
          screen: 'CourseDiscussion',
          trackId: 'track-1',
          itemId: 'item-1',
          postId: reply.id,
        },
      });
    });

    it('does not notify you about your own reply', async () => {
      const post = await service.createPost('item-1', 'thought');
      await service.reply(post.id, 'adding to myself');
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('still saves the reply when the notification fails', async () => {
      const post = await service.createPost('item-1', 'thought');
      as(LEARNER_B);
      createNotification.mockRejectedValueOnce(new Error('db down'));
      await expect(service.reply(post.id, 'agreed')).resolves.toMatchObject({
        content: 'agreed',
      });
    });

    it("hides another organisation's post as not found", async () => {
      const post = await service.createPost('item-1', 'thought');
      as(LEARNER_B, OTHER_TENANT);
      await expect(service.reply(post.id, 'hi')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('editing', () => {
    it('lets an author edit their own post and marks it edited (R7)', async () => {
      const post = await service.createPost('item-1', 'typo');
      const edited = await service.editPost(post.id, 'fixed');
      expect(edited.content).toBe('fixed');
      expect(edited.isEdited).toBe(true);
      expect(edited.editedByModerator).toBe(false);
    });

    it("stops a learner editing someone else's post", async () => {
      const post = await service.createPost('item-1', 'mine');
      as(LEARNER_B);
      await expect(service.editPost(post.id, 'yours')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('closes the author edit window after 15 minutes', async () => {
      const post = await service.createPost('item-1', 'old');
      posts.rows[0].createdAt = new Date(Date.now() - 16 * 60_000);
      await expect(service.editPost(post.id, 'new')).rejects.toThrow(
        /15 minutes/,
      );
      const view = await service.getDiscussion('item-1');
      expect(view.posts[0].canEdit).toBe(false);
    });

    it('lets a moderator edit any post, flagged as a moderator edit (R5)', async () => {
      const post = await service.createPost('item-1', 'inaccurate');
      posts.rows[0].createdAt = new Date(Date.now() - 60 * 60_000);
      as(EDITOR);
      const edited = await service.editPost(post.id, 'corrected');
      expect(edited.content).toBe('corrected');
      expect(edited.editedByModerator).toBe(true);
    });
  });

  describe('deleting', () => {
    it('removes a learner post with no replies outright (R8)', async () => {
      const post = await service.createPost('item-1', 'oops');
      await service.deletePost(post.id);
      const view = await service.getDiscussion('item-1');
      expect(view.posts).toHaveLength(0);
    });

    it('leaves a placeholder when an author deletes a post with replies (R8)', async () => {
      const post = await service.createPost('item-1', 'original');
      as(LEARNER_B);
      await service.reply(post.id, 'reply');
      as(LEARNER_A);
      await service.deletePost(post.id);
      const view = await service.getDiscussion('item-1');
      expect(view.posts[0].isDeletedByAuthor).toBe(true);
      expect(view.posts[0].content).toBeNull();
      expect(view.posts[0].author).toBeNull();
      expect(view.posts[0].replies[0].content).toBe('reply');
      expect(view.postCount).toBe(1);
    });

    it('removes the placeholder once its last reply goes', async () => {
      const post = await service.createPost('item-1', 'original');
      as(LEARNER_B);
      const reply = await service.reply(post.id, 'reply');
      as(LEARNER_A);
      await service.deletePost(post.id);
      as(LEARNER_B);
      await service.deletePost(reply.id);
      const view = await service.getDiscussion('item-1');
      expect(view.posts).toHaveLength(0);
    });

    it("stops a learner deleting someone else's post", async () => {
      const post = await service.createPost('item-1', 'mine');
      as(LEARNER_B);
      await expect(service.deletePost(post.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets a moderator delete a post and all its replies (R4)', async () => {
      const post = await service.createPost('item-1', 'off topic');
      as(LEARNER_B);
      const reply = await service.reply(post.id, 'reply');
      await service.reply(reply.id, 'nested');
      as(EDITOR);
      await service.deletePost(post.id);
      as(LEARNER_A);
      const view = await service.getDiscussion('item-1');
      expect(view.posts).toHaveLength(0);
      expect(posts.rows.every((row) => row.deletedAt)).toBe(true);
    });
  });

  describe('locking', () => {
    it('stops replies in a locked thread and shows it locked (R6)', async () => {
      const post = await service.createPost('item-1', 'thread');
      as(EDITOR);
      await service.setThreadLock(post.id, true);
      as(LEARNER_B);
      await expect(service.reply(post.id, 'late')).rejects.toThrow(
        'This thread is locked.',
      );
      const view = await service.getDiscussion('item-1');
      expect(view.posts[0].isLocked).toBe(true);
      expect(view.posts[0].canReply).toBe(false);
      expect(view.viewer.canPost).toBe(true);
    });

    it('only locks top-level posts', async () => {
      const post = await service.createPost('item-1', 'thread');
      const reply = await service.reply(post.id, 'reply');
      as(EDITOR);
      await expect(service.setThreadLock(reply.id, true)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('stops new posts anywhere once the discussion is locked', async () => {
      await service.createPost('item-1', 'before');
      as(EDITOR);
      await service.setDiscussionLock('item-1', true);
      as(LEARNER_B);
      await expect(service.createPost('item-1', 'after')).rejects.toThrow(
        'This discussion is locked.',
      );
      const view = await service.getDiscussion('item-1');
      expect(view.isLocked).toBe(true);
      expect(view.viewer.canPost).toBe(false);
    });

    it("locks another organisation's discussion when a moderator names it", async () => {
      as(EDITOR, OTHER_TENANT);
      await service.setDiscussionLock('item-1', true, TENANT);
      as(LEARNER_A);
      await expect(service.createPost('item-1', 'hi')).rejects.toThrow(
        'This discussion is locked.',
      );
    });

    it('does not let learners lock', async () => {
      const post = await service.createPost('item-1', 'thread');
      await expect(service.setThreadLock(post.id, true)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.setDiscussionLock('item-1', true)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
