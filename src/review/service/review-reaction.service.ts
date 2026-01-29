import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ReviewReactionRepository } from '../repository/review-reaction.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { GetReviewReactionsResponseDto } from '../dto/review-reaction-response.dto';
import { ToggleReviewReactionDto } from '../dto/toggle-review-reaction.dto';
import { ReviewStatus } from '../type/review.type';
import {
  ReactionAction,
  ReviewReactionOptions,
} from '../type/review-reaction.type';
import { LoggerService } from 'src/logger/logger.service';
import { ReviewRepository } from '../repository/review.repository';
import { UserService } from 'src/user/service/user.service';
import { GetReviewReactionCountResponseDto } from '../dto/get-review-reaction-and-count-response.dto';
import { formatCreatedUserDetails } from '../util/review.util';
import { ReviewAccessValidator } from '../util/review-access-policy.util';
import {
  ReviewEvents,
  ReviewReactionAddedEventParams,
  ReviewReactionRemovedEventParams,
} from '../type/review-event.type';

@Injectable()
export class ReviewReactionService {
  private readonly logger = LoggerService.getInstance(
    ReviewReactionService.name,
  );
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewReactionRepository: ReviewReactionRepository,
    private readonly userService: UserService,
    private readonly eventEmitter: EventEmitter2,
    private readonly reviewAccessValidator: ReviewAccessValidator,
  ) {}

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
      where: { id: reviewId, tenantId },
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
        where: { createdBy: userId, reviewId },
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
      });
      await this.reviewReactionRepository.save(reviewReaction);

      this.eventEmitter.emit(ReviewEvents.REVIEW_REACTION_ADDED, {
        review,
        reaction: reviewReaction,
      } as ReviewReactionAddedEventParams);
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
        },
      });
      if (!reviewReaction) {
        this.logger.error(
          `User ${userId} has not reacted to review ${reviewId}`,
        );
        throw new NotFoundException('Review reaction not found');
      }

      await this.reviewReactionRepository.softDelete({ id: reviewReaction.id });

      this.eventEmitter.emit(ReviewEvents.REVIEW_REACTION_REMOVED, {
        review,
        removedReaction: reviewReaction,
      } as ReviewReactionRemovedEventParams);
      return { success: true };
    }

    if (toggleReviewReactionDto.action === ReactionAction.UPDATE) {
      const existingReaction = await this.reviewReactionRepository.findOne({
        where: {
          reviewId,
          createdBy: userId,
        },
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
      });
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
      where: { id: reviewId, tenantId },
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
      where: { id: reviewId, tenantId },
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
