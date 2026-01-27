import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ReviewStatus } from '../type/review.type';
import { ReactionAction } from '../type/review-reaction.type';
import { ReviewRepository } from '../repository/review.repository';
import { ToggleReviewCommentReactionDto } from '../dto/toggle-review-comment-reaction.dto';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { ReviewEvents } from '../type/review-event.type';

@Injectable()
export class ReviewCommentReactionService {
  private readonly logger = LoggerService.getInstance(
    ReviewCommentReactionService.name,
  );
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly permissionValidator: PermissionValidator,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async toggleReviewCommentReaction(
    reviewCommentId: string,
    toggleReviewCommentReactionDto: ToggleReviewCommentReactionDto,
  ): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const comment = await this.reviewCommentRepository.findOne({
      where: { id: reviewCommentId, tenantId },
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId },
    });
    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId, tenantId },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    const isReviewer = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.REVIEWER_ACCESS],
    );
    const isLearner = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.LEARNER_ACCESS],
    );
    if (
      (isReviewer && review.tenantId !== tenantId) ||
      (!isReviewer && isLearner && review.createdBy !== userId)
    ) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    if (toggleReviewCommentReactionDto.action === ReactionAction.ADD) {
      const existingReaction =
        await this.reviewCommentReactionRepository.findOne({
          where: { createdBy: userId, reviewCommentId },
        });
      if (existingReaction) {
        this.logger.error(
          `User ${userId} has already reacted to comment ${reviewCommentId}`,
        );
        throw new BadRequestException(
          'You have already reacted to this comment',
        );
      }

      const reviewCommentReaction = this.reviewCommentReactionRepository.create(
        {
          reviewCommentId,
          createdBy: userId,
          tenantId,
          reaction: toggleReviewCommentReactionDto.reaction,
        },
      );
      await this.reviewCommentReactionRepository.save(reviewCommentReaction);

      this.eventEmitter.emit(ReviewEvents.REVIEW_COMMENT_REACTION_ADDED, {
        comment,
        reaction: reviewCommentReaction,
      });

      return {
        success: true,
      };
    }

    if (toggleReviewCommentReactionDto.action === ReactionAction.REMOVE) {
      const reviewReaction = await this.reviewCommentReactionRepository.findOne(
        {
          where: {
            reviewCommentId,
            reaction: toggleReviewCommentReactionDto.reaction,
            tenantId,
            createdBy: userId,
          },
        },
      );
      if (!reviewReaction) {
        this.logger.error(
          `User ${userId} has not reacted to comment ${reviewCommentId}`,
        );
        throw new NotFoundException('Review reaction not found');
      }

      await this.reviewCommentReactionRepository.softDelete({
        id: reviewReaction.id,
      });

      this.eventEmitter.emit(ReviewEvents.REVIEW_COMMENT_REACTION_REMOVED, {
        comment,
        removedReaction: reviewReaction,
      });

      return { success: true };
    }

    if (toggleReviewCommentReactionDto.action === ReactionAction.UPDATE) {
      const existingReaction =
        await this.reviewCommentReactionRepository.findOne({
          where: { createdBy: userId, reviewCommentId },
        });
      if (!existingReaction) {
        this.logger.error(
          `User ${userId} has not reacted to comment ${reviewCommentId}`,
        );
        throw new BadRequestException('You have not reacted to this comment');
      }

      if (
        existingReaction.reaction === toggleReviewCommentReactionDto.reaction
      ) {
        this.logger.error(
          `User ${userId} has already reacted to comment ${reviewCommentId} with reaction ${existingReaction.reaction}`,
        );
        throw new BadRequestException(
          'You have already reacted to this comment with this reaction',
        );
      }

      await this.reviewCommentReactionRepository.update(existingReaction.id, {
        reaction: toggleReviewCommentReactionDto.reaction,
      });

      return { success: true };
    }

    throw new BadRequestException('Invalid request');
  }
}
