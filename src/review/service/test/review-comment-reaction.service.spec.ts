import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ReviewCommentReactionService } from '../review-comment-reaction.service';
import { ReviewCommentRepository } from '../../repository/review-comment.repository';
import { ReviewRepository } from '../../repository/review.repository';
import { ReviewThreadRepository } from '../../repository/review-thread.repository';
import { ReviewCommentReactionRepository } from '../../repository/review-comment-reaction.repository';
import { ReviewAccessValidator } from '../../util/review-access-policy.util';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ReviewStatus } from '../../type/review.type';
import { ReactionAction } from '../../type/review-reaction.type';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

jest.mock('src/common/execution/execution-manager');

describe('ReviewCommentReactionService', () => {
  let service: ReviewCommentReactionService;
  let reviewRepository: jest.Mocked<ReviewRepository>;
  let reviewThreadRepository: jest.Mocked<ReviewThreadRepository>;
  let reviewCommentRepository: jest.Mocked<ReviewCommentRepository>;
  let reviewCommentReactionRepository: jest.Mocked<ReviewCommentReactionRepository>;
  let permissionValidator: jest.Mocked<PermissionValidator>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockUserId = 123;
  const mockTenantId = 'tenant-123';
  const mockReviewId = 'review-123';
  const mockThreadId = 'thread-123';
  const mockCommentId = 'comment-123';
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

  const mockThread = {
    id: mockThreadId,
    reviewId: mockReviewId,
    messageId: 1,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    selection: { startIndex: 0, endIndex: 10 },
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

  const mockReactionEntity = {
    id: mockReactionId,
    reviewCommentId: mockCommentId,
    createdBy: mockUserId,
    tenantId: mockTenantId,
    reaction: mockReaction,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewCommentReactionService,
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
          provide: ReviewCommentRepository,
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: ReviewCommentReactionRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            softDelete: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: PermissionValidator,
          useValue: {
            validatePermissions: jest.fn(),
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

    service = module.get<ReviewCommentReactionService>(
      ReviewCommentReactionService,
    );
    reviewRepository = module.get(ReviewRepository);
    reviewThreadRepository = module.get(ReviewThreadRepository);
    reviewCommentRepository = module.get(ReviewCommentRepository);
    reviewCommentReactionRepository = module.get(
      ReviewCommentReactionRepository,
    );
    permissionValidator = module.get(PermissionValidator);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('toggleReviewCommentReaction', () => {
    beforeEach(() => {
      (ExecutionManager.getUserId as jest.Mock).mockReturnValue(
        String(mockUserId),
      );
      (ExecutionManager.getTenantId as jest.Mock).mockReturnValue(mockTenantId);
      reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
      reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
      reviewRepository.findOne.mockResolvedValue(mockReview as any);
      permissionValidator.validatePermissions.mockResolvedValue(false);
    });

    describe('ADD action', () => {
      it('should throw BadRequestException when user has already reacted', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(
          mockReactionEntity as any,
        );

        await expect(
          service.toggleReviewCommentReaction(mockCommentId, {
            reaction: mockReaction,
            action: ReactionAction.ADD,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should successfully add reaction when user is the creator', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(null);
        reviewCommentReactionRepository.create.mockReturnValue(
          mockReactionEntity as any,
        );
        reviewCommentReactionRepository.save.mockResolvedValue(
          mockReactionEntity as any,
        );

        const result = await service.toggleReviewCommentReaction(
          mockCommentId,
          {
            reaction: mockReaction,
            action: ReactionAction.ADD,
          },
        );

        expect(result).toEqual({ success: true });
        expect(reviewCommentReactionRepository.create).toHaveBeenCalledWith({
          reviewCommentId: mockCommentId,
          createdBy: mockUserId,
          tenantId: mockTenantId,
          reaction: mockReaction,
        });
        expect(reviewCommentReactionRepository.save).toHaveBeenCalled();
        expect(eventEmitter.emit).toHaveBeenCalled();
      });

      it('should successfully add reaction when reviewer accesses review from same tenant', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockImplementation(
          async (userId, permissions) => {
            return permissions.includes(PERMISSIONS.REVIEWER_ACCESS);
          },
        );
        reviewCommentReactionRepository.findOne.mockResolvedValue(null);
        reviewCommentReactionRepository.create.mockReturnValue(
          mockReactionEntity as any,
        );
        reviewCommentReactionRepository.save.mockResolvedValue(
          mockReactionEntity as any,
        );

        const result = await service.toggleReviewCommentReaction(
          mockCommentId,
          {
            reaction: mockReaction,
            action: ReactionAction.ADD,
          },
        );

        expect(result).toEqual({ success: true });
      });

      it('should successfully add reaction when learner accesses their own review', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
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
        reviewCommentReactionRepository.findOne.mockResolvedValue(null);
        reviewCommentReactionRepository.create.mockReturnValue(
          mockReactionEntity as any,
        );
        reviewCommentReactionRepository.save.mockResolvedValue(
          mockReactionEntity as any,
        );

        const result = await service.toggleReviewCommentReaction(
          mockCommentId,
          {
            reaction: mockReaction,
            action: ReactionAction.ADD,
          },
        );

        expect(result).toEqual({ success: true });
      });
    });

    describe('REMOVE action', () => {
      it('should throw NotFoundException when reaction not found', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(null);

        await expect(
          service.toggleReviewCommentReaction(mockCommentId, {
            reaction: mockReaction,
            action: ReactionAction.REMOVE,
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('should successfully remove reaction', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(
          mockReactionEntity as any,
        );
        reviewCommentReactionRepository.softDelete.mockResolvedValue(
          undefined as any,
        );

        const result = await service.toggleReviewCommentReaction(
          mockCommentId,
          {
            reaction: mockReaction,
            action: ReactionAction.REMOVE,
          },
        );

        expect(result).toEqual({ success: true });
        expect(reviewCommentReactionRepository.softDelete).toHaveBeenCalledWith(
          { id: mockReactionId },
        );
        expect(eventEmitter.emit).toHaveBeenCalled();
      });
    });

    describe('UPDATE action', () => {
      it('should throw BadRequestException when user has not reacted', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(null);

        await expect(
          service.toggleReviewCommentReaction(mockCommentId, {
            reaction: '1f389',
            action: ReactionAction.UPDATE,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when user has already reacted with the same reaction', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(
          mockReactionEntity as any,
        );

        await expect(
          service.toggleReviewCommentReaction(mockCommentId, {
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
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);
        reviewCommentReactionRepository.findOne.mockResolvedValue(
          existingReaction as any,
        );
        reviewCommentReactionRepository.update.mockResolvedValue(
          undefined as any,
        );

        const result = await service.toggleReviewCommentReaction(
          mockCommentId,
          {
            reaction: mockReaction,
            action: ReactionAction.UPDATE,
          },
        );

        expect(result).toEqual({ success: true });
        expect(reviewCommentReactionRepository.update).toHaveBeenCalledWith(
          mockReactionId,
          { reaction: mockReaction },
        );
      });
    });

    describe('Invalid action', () => {
      it('should throw BadRequestException when action is invalid', async () => {
        reviewCommentRepository.findOne.mockResolvedValue(mockComment as any);
        reviewThreadRepository.findOne.mockResolvedValue(mockThread as any);
        reviewRepository.findOne.mockResolvedValue(mockReview as any);
        permissionValidator.validatePermissions.mockResolvedValue(false);

        await expect(
          service.toggleReviewCommentReaction(mockCommentId, {
            reaction: mockReaction,
            action: 'INVALID' as ReactionAction,
          }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
