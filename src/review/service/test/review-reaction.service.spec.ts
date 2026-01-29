import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReviewReactionService } from '../review-reaction.service';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewReactionRepository } from '../../repository/review-reaction.repository';
import { ReviewAccessValidator } from '../../util/review-access-policy.util';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserService } from 'src/user/service/user.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ReviewStatus } from '../../type/review.type';
import { ReactionAction } from '../../type/review-reaction.type';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

jest.mock('src/common/execution/execution-manager');

describe('ReviewReactionService', () => {
  let service: ReviewReactionService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewReactionRepository: jest.Mocked<ReviewReactionRepository>;
  let permissionValidator: jest.Mocked<PermissionValidator>;
  let userService: jest.Mocked<UserService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockReviewId = 'review-123';
  const mockReactionId = 'reaction-123';
  const mockReaction = '1f44d';

  const mockReview = {
    id: mockReviewId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    status: ReviewStatus.IN_REVIEW,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockReactionEntity = {
    id: mockReactionId,
    reviewId: mockReviewId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    reaction: mockReaction,
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
        ReviewReactionService,
        {
          provide: ReviewRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ReviewReactionRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            softDelete: jest.fn(),
            update: jest.fn(),
            getReviewReactions: jest.fn(),
            getReviewReactionsAndCount: jest.fn(),
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
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
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

    service = module.get<ReviewReactionService>(ReviewReactionService);
    reviewRepository = module.get(ReviewRepository);
    reviewReactionRepository = module.get(ReviewReactionRepository);
    permissionValidator = module.get(PermissionValidator);
    userService = module.get(UserService);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('toggleReviewReactions', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
    });

    describe('ADD action', () => {
      it('should throw BadRequestException when user has already reacted', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(
          mockReactionEntity as any,
        );

        await expect(
          service.toggleReviewReactions(mockReviewId, {
            reaction: mockReaction,
            action: ReactionAction.ADD,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should successfully add reaction when user is the creator', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(null);
        reviewReactionRepository.create.mockReturnValue(
          mockReactionEntity as any,
        );
        reviewReactionRepository.save.mockResolvedValue(
          mockReactionEntity as any,
        );

        const result = await service.toggleReviewReactions(mockReviewId, {
          reaction: mockReaction,
          action: ReactionAction.ADD,
        });

        expect(result).toEqual({ success: true });
        expect(reviewReactionRepository.create).toHaveBeenCalledWith({
          reviewId: mockReviewId,
          createdBy: mockUserId,
          tenantId: mockTenantId,
          reaction: mockReaction,
        });
        expect(reviewReactionRepository.save).toHaveBeenCalled();
        expect(eventEmitter.emit).toHaveBeenCalled();
      });

      it('should successfully add reaction when reviewer accesses review from same tenant', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockImplementation(
          async (userId, permissions) => {
            return permissions.includes(PERMISSIONS.REVIEWER_ACCESS);
          },
        );
        reviewReactionRepository.findOne.mockResolvedValue(null);
        reviewReactionRepository.create.mockReturnValue(
          mockReactionEntity as any,
        );
        reviewReactionRepository.save.mockResolvedValue(
          mockReactionEntity as any,
        );

        const result = await service.toggleReviewReactions(mockReviewId, {
          reaction: mockReaction,
          action: ReactionAction.ADD,
        });

        expect(result).toEqual({ success: true });
      });

      it('should successfully add reaction when learner accesses their own review', async () => {
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
        reviewReactionRepository.findOne.mockResolvedValue(null);
        reviewReactionRepository.create.mockReturnValue(
          mockReactionEntity as any,
        );
        reviewReactionRepository.save.mockResolvedValue(
          mockReactionEntity as any,
        );

        const result = await service.toggleReviewReactions(mockReviewId, {
          reaction: mockReaction,
          action: ReactionAction.ADD,
        });

        expect(result).toEqual({ success: true });
      });
    });

    describe('REMOVE action', () => {
      it('should throw NotFoundException when reaction not found', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(null);

        await expect(
          service.toggleReviewReactions(mockReviewId, {
            reaction: mockReaction,
            action: ReactionAction.REMOVE,
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should successfully remove reaction', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(
          mockReactionEntity as any,
        );
        reviewReactionRepository.softDelete.mockResolvedValue(undefined as any);

        const result = await service.toggleReviewReactions(mockReviewId, {
          reaction: mockReaction,
          action: ReactionAction.REMOVE,
        });

        expect(result).toEqual({ success: true });
        expect(reviewReactionRepository.softDelete).toHaveBeenCalledWith({
          id: mockReactionId,
        });
        expect(eventEmitter.emit).toHaveBeenCalled();
      });
    });

    describe('UPDATE action', () => {
      it('should throw NotFoundException when user has not reacted', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(null);

        await expect(
          service.toggleReviewReactions(mockReviewId, {
            reaction: '1f389',
            action: ReactionAction.UPDATE,
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should throw BadRequestException when user has already reacted with the same reaction', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(
          mockReactionEntity as any,
        );

        await expect(
          service.toggleReviewReactions(mockReviewId, {
            reaction: mockReaction, // Same reaction
            action: ReactionAction.UPDATE,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should successfully update reaction', async () => {
        const existingReaction = {
          ...mockReactionEntity,
          reaction: '1f389', // Different reaction
        };
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewReactionRepository.findOne.mockResolvedValue(
          existingReaction as any,
        );
        reviewReactionRepository.update.mockResolvedValue(undefined as any);

        const result = await service.toggleReviewReactions(mockReviewId, {
          reaction: mockReaction,
          action: ReactionAction.UPDATE,
        });

        expect(result).toEqual({ success: true });
        expect(reviewReactionRepository.update).toHaveBeenCalledWith(
          mockReactionId,
          { reaction: mockReaction },
        );
      });
    });

    describe('Invalid action', () => {
      it('should throw BadRequestException when action is invalid', async () => {
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);

        await expect(
          service.toggleReviewReactions(mockReviewId, {
            reaction: mockReaction,
            action: 'INVALID' as ReactionAction,
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });

  describe('getReviewReactions', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
    });

    it('should return empty array when no reactions found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewReactionRepository.getReviewReactions.mockResolvedValue([[], 0]);

      const result = await service.getReviewReactions(mockReviewId, {});

      expect(result.data).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('should successfully return reactions with user data', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewReactionRepository.getReviewReactions.mockResolvedValue([
        [mockReactionEntity],
        1,
      ]);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewReactions(mockReviewId, {});

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        reaction: mockReaction,
        createdAt: mockReactionEntity.createdAt,
      });
      expect(result.data[0].createdBy).toMatchObject({
        id: mockUserId,
        name: mockUser.name,
        profileImage: mockUser.profileImageUrl,
      });
      expect(result.count).toBe(1);
    });

    it('should filter reactions by reaction type when provided', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewReactionRepository.getReviewReactions.mockResolvedValue([
        [mockReactionEntity],
        1,
      ]);
      userService.getUsersByIds.mockResolvedValue([mockUser] as any);

      const result = await service.getReviewReactions(mockReviewId, {
        reaction: mockReaction,
      });

      expect(reviewReactionRepository.getReviewReactions).toHaveBeenCalledWith(
        mockReviewId,
        { reaction: mockReaction },
      );
      expect(result.data).toHaveLength(1);
    });
  });

  describe('getReviewReactionsAndCount', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
    });

    it('should successfully return reaction counts', async () => {
      const mockReactionCounts = [
        { reaction: '1f44d', count: '10' },
        { reaction: '1f389', count: '5' },
      ];
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewReactionRepository.getReviewReactionsAndCount.mockResolvedValue(
        mockReactionCounts as any,
      );

      const result = await service.getReviewReactionsAndCount(mockReviewId);

      expect(result.reactions).toEqual({
        '1f44d': 10,
        '1f389': 5,
      });
    });

    it('should return empty object when no reactions found', async () => {
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
      reviewReactionRepository.getReviewReactionsAndCount.mockResolvedValue([]);

      const result = await service.getReviewReactionsAndCount(mockReviewId);

      expect(result.reactions).toEqual({});
    });
  });
});
