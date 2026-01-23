import { ForbiddenException } from '@nestjs/common';
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
          useValue: {},
        },
        {
          provide: UserService,
          useValue: {},
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
    permissionValidator = module.get(PermissionValidator);
    dataSource = module.get(DataSource);
  });

  describe('addCommentToReview', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
    });

    it('should throw ForbiddenException when reviewer tries to access review from different tenant', async () => {
      const differentTenantReview = {
        ...mockReview,
        tenantId: 'different-tenant',
      };
      reviewRepository.findOne.mockResolvedValue(differentTenantReview as any);
      permissionValidator.validatePermissions.mockImplementation(
        async (userId, permissions) => {
          if (permissions.includes(PERMISSIONS.REVIEWER_ACCESS)) {
            return true;
          }
          return false;
        },
      );

      const dto = {
        content: 'Test comment',
      };

      await expect(
        service.addCommentToReview(mockReviewId, dto),
      ).rejects.toThrow(ForbiddenException);
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: mockReviewId,
          status: ReviewStatus.IN_REVIEW,
          tenantId: mockTenantId,
        },
      });
    });

    it('should throw ForbiddenException when learner tries to access review they did not create', async () => {
      const otherUserReview = {
        ...mockReview,
        createdBy: 999,
      };
      reviewRepository.findOne.mockResolvedValue(otherUserReview as any);
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

      const dto = {
        content: 'Test comment',
      };

      await expect(
        service.addCommentToReview(mockReviewId, dto),
      ).rejects.toThrow(ForbiddenException);
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: mockReviewId,
          status: ReviewStatus.IN_REVIEW,
          tenantId: mockTenantId,
        },
      });
    });

    it('should successfully add comment to existing thread', async () => {
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
});
