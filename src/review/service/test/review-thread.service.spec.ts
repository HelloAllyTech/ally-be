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
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';

jest.mock('src/common/execution/execution-manager');

describe('ReviewThreadService', () => {
  let service: ReviewThreadService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let permissionValidator: jest.Mocked<PermissionValidator>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockReviewId = 'review-123';

  const mockReview = {
    id: mockReviewId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    createdAt: new Date(),
    updatedAt: new Date(),
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
        {
          provide: ScenarioSharedService,
          useValue: {
            getMessagesByIds: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReviewThreadService>(ReviewThreadService);
    reviewRepository = module.get(ReviewRepository);
    permissionValidator = module.get(PermissionValidator);
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
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId, tenantId: mockTenantId },
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

      await expect(service.getReviewThreads(mockReviewId)).rejects.toThrow(
        ForbiddenException,
      );
      expect(reviewRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockReviewId, tenantId: mockTenantId },
      });
    });
  });
});
