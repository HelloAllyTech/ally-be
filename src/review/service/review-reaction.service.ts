import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReviewReactionRepository } from '../repository/review-reaction.repository';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { GetReviewReactionsResponseDto } from '../dto/review-reaction-response.dto';
import { ToggleReviewReactionDto } from '../dto/toggle-review-reaction.dto';
import {
  ReviewStatus,
  ReactionAction,
  ReviewReactionOptions,
} from '../type/review.type';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ReviewRepository } from '../repository/review.repository';
import { UserService } from 'src/user/service/user.service';
import { GetReviewReactionCountResponseDto } from '../dto/get-review-reaction-and-count-response.dto';
import { formatCreatedUserDetails } from '../util/review.util';

@Injectable()
export class ReviewReactionService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewReactionRepository: ReviewReactionRepository,
    private readonly permissionValidator: PermissionValidator,
    private readonly userService: UserService,
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

    if (toggleReviewReactionDto.action === ReactionAction.ADD) {
      const reviewReaction = this.reviewReactionRepository.create({
        reviewId,
        createdBy: userId,
        tenantId,
        reaction: toggleReviewReactionDto.reaction,
      });
      await this.reviewReactionRepository.save(reviewReaction);
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
        throw new NotFoundException('Review reaction not found');
      }

      await this.reviewReactionRepository.softDelete({ id: reviewReaction.id });
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
