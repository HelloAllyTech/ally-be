import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { ReviewCommentService } from '../review-comment.service';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';
import { UserService } from 'src/user/service/user.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ReviewStatus } from '../../type/review.type';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ReviewComment } from '../../entity/review-comment.entity';
import { ReviewThread } from '../../entity/review-thread.entity';
import { CommunitySharedService } from 'src/community/service/community-shared.service';

jest.mock('src/common/execution/execution-manager');

describe('ReviewCommentService', () => {
  let service: ReviewCommentService;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewThreadRepository: jest.Mocked<ReviewThreadRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;
  let userService: jest.Mocked<UserService>;
  let permissionValidator: jest.Mocked<PermissionValidator>;
  let dataSource: jest.Mocked<DataSource>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockReviewId = 'review-123';
  const mockThreadId = 'thread-123';
  const mockCommentId = 'comment-123';
  const mockParentCommentId = 'parent-comment-123';
  const mockMessageId = 456;

  const mockReview = {
    id: mockReviewId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    status: ReviewStatus.IN_REVIEW,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockThread = {
    id: mockThreadId,
    reviewId: mockReviewId,
    messageId: mockMessageId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    selection: { startIndex: 10, endIndex: 30 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockComment = {
    id: mockCommentId,
    reviewThreadId: mockThreadId,
    content: 'Test comment',
    createdBy: mockUserId,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockParentComment = {
    id: mockParentCommentId,
    reviewThreadId: mockThreadId,
    content: 'Parent comment',
    createdBy: mockUserId,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockUser = {
    id: mockUserId,
    name: 'Test User',
    profileImageUrl: 'https://example.com/profile.jpg',
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const mockTransaction = jest.fn().mockImplementation(async (callback) => {
      const mockEntityManager = {
        create: jest.fn(),
        save: jest.fn(),
      };
      return callback(mockEntityManager);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewCommentService,
        {
          provide: DataSource,
          useValue: {
            transaction: mockTransaction,
          },
        },
        {
          provide: ReviewCommentRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            getCommentsByThreadId: jest.fn(),
            getRepliesByCommentId: jest.fn(),
          },
        },
        {
          provide: ReviewRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ReviewThreadRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
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
          provide: UserService,
          useValue: {
            getUsersByIds: jest.fn(),
          },
        },
        {
          provide: CommunitySharedService,
          useValue: {},
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewCommentService>(ReviewCommentService);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewRepository = module.get(ReviewRepository);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
    userService = module.get(UserService);
    permissionValidator = module.get(PermissionValidator);
    dataSource = module.get(DataSource);

    // Set default mock return values
    reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
      [],
    );
    reviewCommentReactionRepository.find.mockResolvedValue([]);
    userService.getUsersByIds.mockResolvedValue([]);
  });

  describe('addCommentToReview', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should throw BadRequestException when content is empty', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);

      const dto = { content: '   ' };

      await expect(
        service.addCommentToReview(mockReviewId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when parent comment not found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewCommentRepository.findOne.mockResolvedValue(null);

      const dto = {
        content: 'Test reply',
        parentCommentId: mockParentCommentId,
      };

      await expect(
        service.addCommentToReview(mockReviewId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when messageId is missing for new thread', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);

      const dto = {
        content: 'Test comment',
        selection: { startIndex: 10, endIndex: 30 },
      };

      await expect(
        service.addCommentToReview(mockReviewId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when selection is missing for new thread', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);

      const dto = {
        content: 'Test comment',
        messageId: mockMessageId,
      };

      await expect(
        service.addCommentToReview(mockReviewId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully add comment when user is the creator', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewCommentRepository.create.mockReturnValue(mockComment as any);
      reviewCommentRepository.save.mockResolvedValue(mockComment as any);

      const dto = {
        content: 'Test comment',
        threadId: mockThreadId,
      };

      const result = await service.addCommentToReview(mockReviewId, dto);

      expect(result).toEqual({
        comment: {
          id: mockCommentId,
          createdAt: mockComment.createdAt,
        },
      });
    });

    it('should successfully add comment when reviewer accesses review from same tenant', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockImplementation(
        async (userId, permissions) => {
          return permissions.includes(PERMISSIONS.REVIEWER_ACCESS);
        },
      );
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewCommentRepository.create.mockReturnValue(mockComment as any);
      reviewCommentRepository.save.mockResolvedValue(mockComment as any);

      const dto = {
        content: 'Test comment',
        threadId: mockThreadId,
      };

      const result = await service.addCommentToReview(mockReviewId, dto);

      expect(result).toEqual({
        comment: {
          id: mockCommentId,
          createdAt: mockComment.createdAt,
        },
      });
    });

    it('should successfully add comment when learner accesses their own review', async () => {
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
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewCommentRepository.create.mockReturnValue(mockComment as any);
      reviewCommentRepository.save.mockResolvedValue(mockComment as any);

      const dto = {
        content: 'Test comment',
        threadId: mockThreadId,
      };

      const result = await service.addCommentToReview(mockReviewId, dto);

      expect(result).toEqual({
        comment: {
          id: mockCommentId,
          createdAt: mockComment.createdAt,
        },
      });
    });

    it('should successfully add comment to existing thread', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewCommentRepository.create.mockReturnValue(mockComment as any);
      reviewCommentRepository.save.mockResolvedValue(mockComment as any);

      const dto = {
        content: 'Test comment',
        threadId: mockThreadId,
      };

      const result = await service.addCommentToReview(mockReviewId, dto);

      expect(result).toEqual({
        comment: {
          id: mockCommentId,
          createdAt: mockComment.createdAt,
        },
      });
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: mockReviewId,
          status: ReviewStatus.IN_REVIEW,
          tenantId: mockTenantId,
        },
      });
      expect(reviewCommentRepository.create).toHaveBeenCalledWith({
        reviewThreadId: mockThreadId,
        content: dto.content,
        createdBy: mockUserId,
        tenantId: mockTenantId,
      });
    });

    it('should successfully add reply to parent comment', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewCommentRepository.findOne.mockResolvedValue(
        mockParentComment as any,
      );
      const mockReply = {
        ...mockComment,
        id: 'reply-123',
        parentCommentId: mockParentCommentId,
      };
      reviewCommentRepository.create.mockReturnValue(mockReply as any);
      reviewCommentRepository.save.mockResolvedValue(mockReply as any);

      const dto = {
        content: 'Test reply',
        parentCommentId: mockParentCommentId,
      };

      const result = await service.addCommentToReview(mockReviewId, dto);

      expect(result).toEqual({
        reply: {
          id: 'reply-123',
          createdAt: mockReply.createdAt,
        },
      });
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: mockReviewId,
          status: ReviewStatus.IN_REVIEW,
          tenantId: mockTenantId,
        },
      });
      expect(reviewCommentRepository.create).toHaveBeenCalledWith({
        reviewThreadId: mockThreadId,
        content: dto.content,
        createdBy: mockUserId,
        parentCommentId: mockParentCommentId,
        tenantId: mockTenantId,
      });
    });

    it('should successfully create new thread with comment', async () => {
      let createdThread: any;

      const mockEntityManager = {
        create: jest.fn(),
        save: jest.fn(),
      };

      mockEntityManager.create.mockImplementation((entity, data) => {
        if (entity === ReviewThread) {
          createdThread = { ...mockThread, ...data };
          return createdThread;
        }
        if (entity === ReviewComment) {
          return { ...mockComment, ...data };
        }
        return data;
      });
      mockEntityManager.save.mockImplementation(async (entity, data) => {
        // Mutate the data object to add id (as TypeORM does)
        // This ensures thread.id is available when creating the comment
        if (entity === ReviewThread) {
          data.id = mockThreadId;
          createdThread.id = mockThreadId;
        } else if (entity === ReviewComment) {
          data.id = mockCommentId;
        }
        return data;
      });

      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback(mockEntityManager);
        },
      );

      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);

      const dto = {
        content: 'Test comment',
        messageId: mockMessageId,
        selection: { startIndex: 10, endIndex: 30 },
      };

      const result = await service.addCommentToReview(mockReviewId, dto);

      expect(result).toEqual({
        thread: {
          id: mockThreadId,
          createdAt: createdThread.createdAt,
        },
        comment: {
          id: mockCommentId,
          createdAt: mockComment.createdAt,
        },
      });
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: mockReviewId,
          status: ReviewStatus.IN_REVIEW,
          tenantId: mockTenantId,
        },
      });
      expect(mockEntityManager.create).toHaveBeenCalledWith(ReviewThread, {
        reviewId: mockReviewId,
        messageId: mockMessageId,
        createdBy: mockUserId,
        selection: dto.selection,
        tenantId: mockTenantId,
      });
      expect(mockEntityManager.save).toHaveBeenCalledWith(
        ReviewThread,
        expect.objectContaining({
          reviewId: mockReviewId,
          messageId: mockMessageId,
          createdBy: mockUserId,
          selection: dto.selection,
          tenantId: mockTenantId,
        }),
      );
      expect(mockEntityManager.create).toHaveBeenCalledWith(ReviewComment, {
        reviewThreadId: mockThreadId,
        content: dto.content,
        createdBy: mockUserId,
        tenantId: mockTenantId,
      });
      expect(mockEntityManager.save).toHaveBeenCalledWith(
        ReviewComment,
        expect.objectContaining({
          reviewThreadId: mockThreadId,
          content: dto.content,
          createdBy: mockUserId,
          tenantId: mockTenantId,
        }),
      );
    });
  });

  describe('getReviewComments', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
    });

    it('should return empty array when no comments found', async () => {
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewCommentRepository.getCommentsByThreadId.mockResolvedValue({
        comments: [],
        count: 0,
      } as any);

      const result = await service.getReviewComments(mockThreadId);

      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should successfully return comments with reactions and user data', async () => {
      const mockCommentData = {
        c_id: mockCommentId,
        c_content: 'Test comment',
        c_createdAt: new Date(),
        c_createdBy: mockUserId,
        c_hidden: false,
        reply_count: '0',
      };
      const mockReaction = {
        commentId: mockCommentId,
        reaction: 'like',
        count: '5',
      };
      const mockMyReaction = {
        reviewCommentId: mockCommentId,
        reaction: 'like',
      };

      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewCommentRepository.getCommentsByThreadId.mockResolvedValue({
        comments: [mockCommentData],
        count: 1,
      } as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [mockReaction] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([
        mockMyReaction,
      ] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewComments(mockThreadId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: mockCommentId,
        content: mockCommentData.c_content,
        reactions: { like: 5 },
        myReaction: 'like',
        replyCount: 0,
      });
      expect(result.count).toBe(1);
    });
  });

  describe('getReviewCommentReplies', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewCommentRepository.findOne.mockResolvedValue(
        mockParentComment as any,
      );
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
    });

    it('should return empty array when no replies found', async () => {
      reviewCommentRepository.findOne.mockResolvedValue(
        mockParentComment as any,
      );
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewCommentRepository.getRepliesByCommentId.mockResolvedValue([
        [],
        0,
      ] as any);

      const result = await service.getReviewCommentReplies(mockCommentId);

      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should successfully return replies with reactions and user data', async () => {
      const mockReply = {
        id: 'reply-123',
        content: 'Test reply',
        createdAt: new Date(),
        createdBy: mockUserId,
        hidden: false,
      };
      const mockReaction = {
        commentId: 'reply-123',
        reaction: 'like',
        count: '3',
      };

      reviewCommentRepository.findOne.mockResolvedValue(
        mockParentComment as any,
      );
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewCommentRepository.getRepliesByCommentId.mockResolvedValue([
        [mockReply],
        1,
      ] as any);
      reviewCommentReactionRepository.getReactionAndCountByCommentIds.mockResolvedValue(
        [mockReaction] as any,
      );
      reviewCommentReactionRepository.find.mockResolvedValue([] as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewCommentReplies(mockCommentId);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        id: 'reply-123',
        content: mockReply.content,
        reactions: { like: 3 },
      });
      expect(result.count).toBe(1);
    });
  });

  describe('editReviewComment', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
    });

    it('should throw BadRequestException when edit time limit exceeded', async () => {
      const oldComment = {
        ...mockComment,
        createdAt: new Date(Date.now() - 100000000), // Very old comment
      };
      reviewCommentRepository.findOne.mockResolvedValue(oldComment as any);

      await expect(
        service.editReviewComment(mockCommentId, { content: 'Updated' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully edit comment', async () => {
      const recentComment = {
        ...mockComment,
        createdAt: new Date(), // Recent comment
      };
      reviewCommentRepository.findOne.mockResolvedValue(recentComment as any);
      reviewCommentRepository.save.mockResolvedValue({
        ...recentComment,
        content: 'Updated',
      } as any);

      const result = await service.editReviewComment(mockCommentId, {
        content: 'Updated',
      });

      expect(result).toEqual({ success: true });
      expect(reviewCommentRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Updated',
        }),
      );
    });
  });

  describe('deleteReviewComment', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
    });

    it('should successfully delete reply', async () => {
      const replyComment = {
        ...mockComment,
        parentCommentId: mockParentCommentId,
      };
      reviewCommentRepository.findOne.mockResolvedValue(replyComment as any);
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          softDelete: jest.fn().mockResolvedValue(undefined),
        }),
      };

      reviewCommentRepository.findOne.mockResolvedValue(replyComment as any);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback(mockEntityManager);
        },
      );

      const result = await service.deleteReviewComment(mockCommentId);

      expect(result).toEqual({ success: true });
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should successfully delete comment and thread when it is the last comment', async () => {
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          softDelete: jest.fn().mockResolvedValue(undefined),
        }),
      };

      reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewCommentRepository.count.mockResolvedValue(1); // Only one comment
      reviewCommentRepository.find.mockResolvedValue([]); // No replies
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback(mockEntityManager);
        },
      );

      const result = await service.deleteReviewComment(mockCommentId);

      expect(result).toEqual({ success: true });
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('should successfully delete comment with replies', async () => {
      const mockReply = {
        id: 'reply-123',
        reviewThreadId: mockThreadId,
      };
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          softDelete: jest.fn().mockResolvedValue(undefined),
        }),
      };

      reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewCommentRepository.count.mockResolvedValue(2); // Multiple comments
      reviewCommentRepository.find.mockResolvedValue([mockReply] as any);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback(mockEntityManager);
        },
      );

      const result = await service.deleteReviewComment(mockCommentId);

      expect(result).toEqual({ success: true });
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('toggleCommentVisibility', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
    });

    it('should successfully toggle reply visibility', async () => {
      const replyComment = {
        ...mockComment,
        parentCommentId: mockParentCommentId,
      };
      reviewCommentRepository.findOne.mockResolvedValue(replyComment as any);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      reviewCommentRepository.update.mockResolvedValue(undefined as any);

      const result = await service.toggleCommentVisibility(mockCommentId, {
        hidden: true,
      });

      expect(result).toEqual({ success: true });
      expect(reviewCommentRepository.update).toHaveBeenCalledWith(
        mockCommentId,
        { hidden: true },
      );
    });

    it('should successfully toggle comment and replies visibility', async () => {
      const mockEntityManager = {
        getRepository: jest.fn().mockReturnValue({
          update: jest.fn().mockResolvedValue(undefined),
        }),
      };

      reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      (dataSource.transaction as jest.Mock).mockImplementation(
        async (callback) => {
          return callback(mockEntityManager);
        },
      );

      const result = await service.toggleCommentVisibility(mockCommentId, {
        hidden: true,
      });

      expect(result).toEqual({ success: true });
      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });
});
