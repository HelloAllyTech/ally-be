import { Test, TestingModule } from '@nestjs/testing';
import { ReviewThreadService } from '../review-thread.service';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';
import { ReviewAccessValidator } from '../../util/review-access-policy.util';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserService } from 'src/user/service/user.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';

jest.mock('src/common/execution/execution-manager');

describe('ReviewThreadService', () => {
  let service: ReviewThreadService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewThreadRepository: jest.Mocked<ReviewThreadRepository>;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;
  let userService: jest.Mocked<UserService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let permissionValidator: jest.Mocked<PermissionValidator>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockReviewId = 'review-123';

  const mockReview = {
    id: mockReviewId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    status: 'IN_REVIEW',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockThreadId = 'thread-123';
  const mockMessageId = 1;
  const mockCommentId = 'comment-123';

  const mockThread = {
    id: mockThreadId,
    reviewId: mockReviewId,
    messageId: mockMessageId,
    createdBy: mockUserId,
    selection: { startIndex: 0, endIndex: 10 },
  };

  const mockComment = {
    comment_id: mockCommentId,
    comment_reviewThreadId: mockThreadId,
    comment_content: 'Test comment',
    comment_createdAt: new Date(),
    comment_createdBy: mockUserId,
    comment_hidden: false,
    reply_count: '0',
    row_num: 1,
  };

  const mockUser = {
    id: mockUserId,
    name: 'Test User',
    profileImageUrl: 'https://example.com/profile.jpg',
  };

  const mockMessage = {
    id: mockMessageId,
    content: 'Test message',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewThreadService,
        {
          provide: ReviewThreadRepository,
          useValue: {
            getReviewThreadsByReviewId: jest.fn(),
          },
        },
        {
          provide: ReviewRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ReviewCommentRepository,
          useValue: {
            getCommentsForThreadIds: jest.fn(),
            getCommentCountsByThreadIds: jest.fn(),
          },
        },
        {
          provide: ReviewCommentReactionRepository,
          useValue: {
            getReactionAndCountByCommentIds: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            getUsersByIds: jest.fn(),
          },
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            getMessagesByIds: jest.fn(),
          },
        },
        {
          provide: ReviewAccessValidator,
          useValue: {
            validateAccess: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewThreadService>(ReviewThreadService);
    reviewRepository = module.get(ReviewRepository);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
    userService = module.get(UserService);
    scenarioSharedService = module.get(ScenarioSharedService);
    permissionValidator = module.get(PermissionValidator);

    // Set default mock return values
    reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([]);
    reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([]);
    reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
      [],
    );
    reviewCommentReactionRepository.find.mockResolvedValue([]);
    userService.getUsersByIds.mockResolvedValue([]);
  });

  describe('getReviewThreads', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should return empty array when totalCount is 0', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [],
        count: 0,
      } as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
      expect(
        reviewCommentRepository.getCommentsForThreadIds,
      ).not.toHaveBeenCalled();
    });

    it('should successfully return review threads when user is the creator', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: mockThreadId,
        selection: mockThread.selection,
        commentCount: 1,
      });
      expect(result.data[0].comments).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it('should successfully return review threads when reviewer accesses review from same tenant', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockImplementation(
        async (userId, permissions) => {
          return permissions.includes(PERMISSIONS.REVIEWER_ACCESS);
        },
      );
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it('should successfully return review threads when learner accesses their own review', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockImplementation(
        async (userId, permissions) => {
          if (permissions.includes(PERMISSIONS.REVIEWER_ACCESS)) {
            return false;
          }
          if (permissions.includes(PERMISSIONS.LEARNER_ACCESS)) {
            return true;
          }
          return false;
        },
      );
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.count).toBe(1);
    });

    it('should include message when includeMessage option is true', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);
      scenarioSharedService.getMessagesByIds.mockResolvedValue([
        mockMessage,
      ] as any);

      const result = await service.getReviewThreads(mockReviewId, {
        includeMessage: true,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].message).toBeDefined();
      expect(result.data[0].message).toMatchObject({
        id: mockMessageId,
        content: mockMessage.content,
      });
      expect(scenarioSharedService.getMessagesByIds).toHaveBeenCalledWith([
        mockMessageId,
      ]);
    });

    it('should not include message when includeMessage option is false or undefined', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId, {
        includeMessage: false,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].message).toBeUndefined();
      expect(scenarioSharedService.getMessagesByIds).not.toHaveBeenCalled();
    });

    it('should return threads with comments, reactions, and user data', async () => {
      const mockReaction = {
        commentId: mockCommentId,
        reaction: 'like',
        count: '5',
      };
      const mockMyReaction = {
        reviewCommentId: mockCommentId,
        reaction: 'like',
      };

      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [mockReaction] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([
        mockMyReaction,
      ] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.comments).toHaveLength(1);
      expect(result.data[0]?.comments?.[0]).toMatchObject({
        id: mockCommentId,
        content: mockComment.comment_content,
        reactions: { like: 5 },
        myReaction: 'like',
        replyCount: 0,
      });
      expect(result.data[0]?.comments?.[0]?.createdBy).toMatchObject({
        id: mockUserId,
        name: mockUser.name,
        profileImage: mockUser.profileImageUrl,
      });
    });

    it('should handle missing message when includeMessage is true', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);
      scenarioSharedService.getMessagesByIds.mockResolvedValue([] as any); // No messages found

      const result = await service.getReviewThreads(mockReviewId, {
        includeMessage: true,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].message).toBeUndefined();
    });

    it('should handle comments with missing user data', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([]); // No users found

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.comments).toHaveLength(1);
      expect(result.data[0]?.comments?.[0]?.createdBy).toEqual({});
    });

    it('should handle multiple threads correctly', async () => {
      const mockThread2 = {
        id: 'thread-456',
        reviewId: mockReviewId,
        messageId: 2,
        createdBy: mockUserId,
        selection: { startIndex: 20, endIndex: 30 },
      };
      const mockComment2 = {
        c_id: 'comment-456',
        c_reviewThreadId: 'thread-456',
        c_content: 'Second comment',
        c_createdAt: new Date(),
        c_createdBy: mockUserId,
        c_hidden: false,
        reply_count: '0',
        row_num: 1,
      };

      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread, mockThread2],
        count: 2,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
        mockComment2,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
        { reviewThreadId: 'thread-456', commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.data[0].id).toBe(mockThreadId);
      expect(result.data[1].id).toBe('thread-456');
    });

    it('should handle threads without comment counts', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue(
        [], // No comment counts
      );
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].commentCount).toBeUndefined();
    });

    it('should handle threads without comments', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([]); // No comments
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 0 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([]);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].comments).toEqual([]);
      expect(result.data[0].commentCount).toBe(0);
    });

    it('should filter comments by row_num limit correctly', async () => {
      const mockComment2 = {
        ...mockComment,
        c_id: 'comment-456',
        row_num: 2, // This should be filtered out (limit is 1)
      };

      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: [mockThread],
        count: 1,
      } as any);
      reviewCommentRepository.getCommentsForThreadIds.mockResolvedValue([
        mockComment,
        mockComment2, // This should be filtered out
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      reviewCommentRepository.getCommentCountsByThreadIds.mockResolvedValue([
        { reviewThreadId: mockThreadId, commentCount: 1 },
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].comments).toHaveLength(1); // Only one comment should be included
      expect(result.data[0]?.comments?.[0]?.id).toBe(mockCommentId);
    });
  });
});
