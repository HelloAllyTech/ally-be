import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ReviewThreadService } from '../review-thread.service';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserService } from 'src/user/service/user.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

jest.mock('src/common/execution/execution-manager');

describe('ReviewThreadService', () => {
  let service: ReviewThreadService;
  let reviewThreadRepository: jest.Mocked<ReviewThreadRepository>;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;
  let permissionValidator: jest.Mocked<PermissionValidator>;
  let userService: jest.Mocked<UserService>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockReviewId = 'review-123';
  const mockThreadId1 = 'thread-1';
  const mockThreadId2 = 'thread-2';
  const mockCommentId1 = 'comment-1';
  const mockCommentId2 = 'comment-2';
  const mockCommentId3 = 'comment-3';

  const mockReview = {
    id: mockReviewId,
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
            find: jest.fn(),
          },
        },
        {
          provide: ReviewCommentReactionRepository,
          useValue: {
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
      ],
    }).compile();

    service = module.get<ReviewThreadService>(ReviewThreadService);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewRepository = module.get(ReviewRepository);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
    permissionValidator = module.get(PermissionValidator);
    userService = module.get(UserService);
  });

  describe('getReviewThreads', () => {
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

      await expect(service.getReviewThreads(mockReviewId)).rejects.toThrow(
        ForbiddenException,
      );
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

      await expect(service.getReviewThreads(mockReviewId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should successfully return review threads with comments, reactions, and reply counts', async () => {
      const mockThreads = [{ id: mockThreadId1 }, { id: mockThreadId2 }];
      const mockComments = [
        {
          id: mockCommentId1,
          reviewThreadId: mockThreadId1,
          content: 'First comment',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          createdBy: mockUserId,
          parentCommentId: null,
        },
        {
          id: mockCommentId2,
          reviewThreadId: mockThreadId1,
          content: 'Reply to first',
          createdAt: new Date('2024-01-01T10:05:00Z'),
          createdBy: mockUserId,
          parentCommentId: mockCommentId1,
        },
        {
          id: mockCommentId3,
          reviewThreadId: mockThreadId2,
          content: 'Second thread comment',
          createdAt: new Date('2024-01-01T11:00:00Z'),
          createdBy: mockUserId,
          parentCommentId: null,
        },
      ];
      const mockReactions = [
        {
          reviewCommentId: mockCommentId1,
          reaction: 'thumbsUp',
        },
        {
          reviewCommentId: mockCommentId1,
          reaction: 'thumbsUp',
        },
        {
          reviewCommentId: mockCommentId1,
          reaction: 'heart',
        },
        {
          reviewCommentId: mockCommentId3,
          reaction: 'thumbsUp',
        },
      ];

      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewThreadRepository.getReviewThreadsByReviewId.mockResolvedValue({
        threads: mockThreads as any,
        count: 2,
      });
      reviewCommentRepository.find.mockResolvedValue(mockComments as any);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);
      reviewCommentReactionRepository.find.mockResolvedValue(
        mockReactions as any,
      );

      const result = await service.getReviewThreads(mockReviewId);

      expect(result.count).toBe(2);
      expect(result.data).toHaveLength(2);

      // Verify top-level comments only (replies filtered out)
      const allCommentIds = result.data.flatMap(
        (thread) => thread.comments?.map((c) => c.id) || [],
      );
      expect(allCommentIds).not.toContain(mockCommentId2);

      // Verify reactions aggregation and reply counts
      expect(result.data[0].comments![0].replyCount).toBe(1);
      expect(result.data[0].comments![0].reactions).toEqual({
        thumbsUp: 2,
        heart: 1,
      });
      expect(result.data[1].comments![0].replyCount).toBe(0);
      expect(result.data[1].comments![0].reactions).toEqual({
        thumbsUp: 1,
      });
    });
  });
});
