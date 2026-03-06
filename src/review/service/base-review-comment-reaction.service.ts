import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { ReviewStatus } from '../type/review.type';
import { ReactionAction } from '../type/review-reaction.type';
import { ToggleReviewCommentReactionDto } from '../dto/toggle-review-comment-reaction.dto';
import { ReviewAccessValidator } from '../util/review-access-policy.util';
import { BaseReview } from '../entity/base-review.entity';
import { BaseReviewThread } from '../entity/base-review-thread.entity';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReviewCommentReaction } from '../entity/base-review-comment-reaction.entity';

export abstract class BaseReviewCommentReactionService<
  TReview extends BaseReview,
  TThread extends BaseReviewThread,
  TComment extends BaseReviewComment,
  TCommentReaction extends BaseReviewCommentReaction,
> {
  protected abstract readonly logger: LoggerService;
  protected abstract readonly reviewRepository: Repository<TReview>;
  protected abstract readonly reviewThreadRepository: Repository<TThread>;
  protected abstract readonly reviewCommentRepository: Repository<TComment>;
  protected abstract readonly reviewCommentReactionRepository: Repository<TCommentReaction>;
  protected abstract readonly reviewAccessValidator: ReviewAccessValidator;

  protected onCommentReactionAdded(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    review: TReview,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    comment: TComment,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    reaction: TCommentReaction,
  ): void {}
  protected onCommentReactionRemoved(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    review: TReview,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    comment: TComment,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    removedReaction: TCommentReaction,
  ): void {}

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
      where: { id: reviewCommentId, tenantId } as any,
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: (comment as any).reviewThreadId } as any,
    });
    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: (thread as any).reviewId, tenantId } as any,
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    await this.reviewAccessValidator.validateAccess(review, userId);

    if (toggleReviewCommentReactionDto.action === ReactionAction.ADD) {
      const existingReaction =
        await this.reviewCommentReactionRepository.findOne({
          where: { createdBy: userId, reviewCommentId } as any,
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
        } as any,
      ) as unknown as TCommentReaction;
      await this.reviewCommentReactionRepository.save(reviewCommentReaction);

      this.onCommentReactionAdded(review, comment, reviewCommentReaction);

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
          } as any,
        },
      );
      if (!reviewReaction) {
        this.logger.error(
          `User ${userId} has not reacted to comment ${reviewCommentId}`,
        );
        throw new NotFoundException('Review reaction not found');
      }

      await this.reviewCommentReactionRepository.softDelete({
        id: (reviewReaction as any).id,
      } as any);

      this.onCommentReactionRemoved(review, comment, reviewReaction);

      return { success: true };
    }

    if (toggleReviewCommentReactionDto.action === ReactionAction.UPDATE) {
      const existingReaction =
        await this.reviewCommentReactionRepository.findOne({
          where: { createdBy: userId, reviewCommentId } as any,
        });
      if (!existingReaction) {
        this.logger.error(
          `User ${userId} has not reacted to comment ${reviewCommentId}`,
        );
        throw new BadRequestException('You have not reacted to this comment');
      }

      if (
        (existingReaction as any).reaction ===
        toggleReviewCommentReactionDto.reaction
      ) {
        this.logger.error(
          `User ${userId} has already reacted to comment ${reviewCommentId} with reaction ${(existingReaction as any).reaction}`,
        );
        throw new BadRequestException(
          'You have already reacted to this comment with this reaction',
        );
      }

      await this.reviewCommentReactionRepository.update(
        (existingReaction as any).id,
        {
          reaction: toggleReviewCommentReactionDto.reaction,
        } as any,
      );

      return { success: true };
    }

    throw new BadRequestException('Invalid request');
  }
}
