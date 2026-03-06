import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { GetReviewReactionsResponseDto } from '../dto/review-reaction-response.dto';
import { ToggleReviewReactionDto } from '../dto/toggle-review-reaction.dto';
import { ReviewStatus } from '../type/review.type';
import {
  ReactionAction,
  ReviewReactionOptions,
} from '../type/review-reaction.type';
import { UserService } from 'src/user/service/user.service';
import { GetReviewReactionCountResponseDto } from '../dto/get-review-reaction-and-count-response.dto';
import { formatCreatedUserDetails } from '../util/review.util';
import { ReviewAccessValidator } from '../util/review-access-policy.util';
import { BaseReview } from '../entity/base-review.entity';
import { BaseReviewReaction } from '../entity/base-review-reaction.entity';
import { BaseReviewReactionRepository } from '../repository/base-review-reaction.repository';

export abstract class BaseReviewReactionService<
  TReview extends BaseReview,
  TReaction extends BaseReviewReaction,
> {
  protected abstract readonly logger: LoggerService;
  protected abstract readonly reviewRepository: Repository<TReview>;
  protected abstract readonly reviewReactionRepository: BaseReviewReactionRepository<
    TReaction,
    TReview
  >;
  protected abstract readonly userService: UserService;
  protected abstract readonly reviewAccessValidator: ReviewAccessValidator;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onReactionAdded(review: TReview, reaction: TReaction): void {}

  protected onReactionRemoved(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    review: TReview,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    removedReaction: TReaction,
  ): void {}

  async toggleReviewReactions(
    reviewId: string,
    toggleReviewReactionDto: ToggleReviewReactionDto,
  ): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: reviewId, tenantId } as any,
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    await this.reviewAccessValidator.validateAccess(review, userId);

    if (toggleReviewReactionDto.action === ReactionAction.ADD) {
      const existingReaction = await this.reviewReactionRepository.findOne({
        where: { createdBy: userId, reviewId } as any,
      });

      if (existingReaction) {
        this.logger.error(
          `User ${userId} has already reacted to review ${reviewId}`,
        );
        throw new BadRequestException(
          'You have already reacted to this review',
        );
      }

      const reviewReaction = this.reviewReactionRepository.create({
        reviewId,
        createdBy: userId,
        tenantId,
        reaction: toggleReviewReactionDto.reaction,
      } as any) as unknown as TReaction;
      await this.reviewReactionRepository.save(reviewReaction);

      this.onReactionAdded(review, reviewReaction);
      return {
        success: true,
      };
    }

    if (toggleReviewReactionDto.action === ReactionAction.REMOVE) {
      const reviewReaction = await this.reviewReactionRepository.findOne({
        where: {
          reviewId,
          reaction: toggleReviewReactionDto.reaction,
          tenantId,
          createdBy: userId,
        } as any,
      });
      if (!reviewReaction) {
        this.logger.error(
          `User ${userId} has not reacted to review ${reviewId}`,
        );
        throw new NotFoundException('Review reaction not found');
      }

      await this.reviewReactionRepository.softDelete({
        id: reviewReaction.id,
      } as any);

      this.onReactionRemoved(review, reviewReaction);
      return { success: true };
    }

    if (toggleReviewReactionDto.action === ReactionAction.UPDATE) {
      const existingReaction = await this.reviewReactionRepository.findOne({
        where: {
          reviewId,
          createdBy: userId,
        } as any,
      });
      if (!existingReaction) {
        this.logger.error(
          `User ${userId} has not reacted to review ${reviewId}`,
        );
        throw new NotFoundException('Review reaction not found');
      }

      if (existingReaction.reaction === toggleReviewReactionDto.reaction) {
        this.logger.error(
          `User ${userId} has already reacted to review ${reviewId} with reaction ${existingReaction.reaction}`,
        );
        throw new BadRequestException(
          'You have already reacted to this review with this reaction',
        );
      }

      await this.reviewReactionRepository.update(existingReaction.id, {
        reaction: toggleReviewReactionDto.reaction,
      } as any);
      return { success: true };
    }

    throw new BadRequestException('Invalid request');
  }

  async getReviewReactions(
    reviewId: string,
    options: ReviewReactionOptions,
  ): Promise<GetReviewReactionsResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: reviewId, tenantId } as any,
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    await this.reviewAccessValidator.validateAccess(review, userId);

    const [reviewReactions, count] =
      await this.reviewReactionRepository.getReviewReactions(reviewId, options);

    if (reviewReactions.length === 0) {
      return {
        data: [],
        count: 0,
      };
    }

    const userIds = [
      ...new Set(
        reviewReactions.map((reviewReaction) => reviewReaction.createdBy),
      ),
    ];

    const users = await this.userService.getUsersByIds(userIds);
    const userMap = new Map(
      users.map((user) => [user.id, formatCreatedUserDetails(user)]),
    );
    const data = reviewReactions.map((reviewReaction) => {
      const user = userMap.get(reviewReaction.createdBy)!;

      return {
        reaction: reviewReaction.reaction,
        createdBy: user,
        createdAt: reviewReaction.createdAt,
      };
    });

    return { data, count };
  }

  async getReviewReactionsAndCount(
    reviewId: string,
  ): Promise<GetReviewReactionCountResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: reviewId, tenantId } as any,
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    await this.reviewAccessValidator.validateAccess(review, userId);

    const result =
      await this.reviewReactionRepository.getReviewReactionsAndCount(reviewId);

    const reactions = result.reduce(
      (acc, { reaction, count }) => {
        acc[reaction] = parseInt(count);
        return acc;
      },
      {} as Record<string, number>,
    );

    return { reactions };
  }
}
