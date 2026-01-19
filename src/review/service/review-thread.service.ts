import {
  NotFoundException,
  ForbiddenException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { Pagination } from 'src/common/type/common.type';
import { User } from 'src/user/entity/user.entity';
import { UserService } from 'src/user/service/user.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { ReviewRepository } from '../repository/review.repository';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';

@Injectable()
export class ReviewThreadService {
  constructor(
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly permissionValidator: PermissionValidator,
    private readonly userService: UserService,
  ) {}

  async getReviewThreads(
    reviewId: string,
    options?: Pagination,
  ): Promise<ReviewThreadsResponseDto> {
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

    const userId = Number(ExecutionManager.getUserId());
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

    const { threads: reviewThreads, count: totalCount } =
      await this.reviewThreadRepository.getReviewThreadsByReviewId(
        reviewId,
        options,
      );

    const reviewComments = await this.reviewCommentRepository.find({
      where: { reviewThreadId: In(reviewThreads.map((thread) => thread.id)) },
    });

    // Filter to get only top-level comment IDs for reactions query
    // (we only display top-level comments, so we don't need reactions for replies)
    const topLevelCommentIds = reviewComments
      .filter((comment) => !comment.parentCommentId)
      .map((comment) => comment.id);

    const usersPromise = this.userService.getUsersByIds(
      reviewComments.map((comment) => comment.createdBy),
    );
    // Only fetch reactions for top-level comments (optimization)
    const reviewCommentReactionsPromise =
      topLevelCommentIds.length > 0
        ? this.reviewCommentReactionRepository.find({
            where: {
              reviewCommentId: In(topLevelCommentIds),
            },
          })
        : Promise.resolve([]);

    const [users, reviewCommentReactions] = await Promise.all([
      usersPromise,
      reviewCommentReactionsPromise,
    ]);

    const usersMap = new Map<number, User>();
    users.forEach((user) => {
      usersMap.set(user.id, user);
    });
    const reviewCommentReactionsMap = new Map<
      string,
      ReviewCommentReaction[]
    >();
    reviewCommentReactions.forEach((reaction) => {
      reviewCommentReactionsMap.set(reaction.reviewCommentId, [
        ...(reviewCommentReactionsMap.get(reaction.reviewCommentId) || []),
        reaction,
      ]);
    });

    const reviewThreadsData = reviewThreads.map((thread) => {
      const allComments = reviewComments.filter(
        (comment) => comment.reviewThreadId === thread.id,
      );
      // Only include top-level comments (those without parentCommentId)
      const topLevelComments = allComments.filter(
        (comment) => !comment.parentCommentId,
      );
      return {
        id: thread.id,
        comments: topLevelComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          createdAt: comment.createdAt,
          createdBy: {
            id: comment.createdBy,
            name: usersMap.get(comment.createdBy)?.name,
            profileImage: usersMap.get(comment.createdBy)?.profileImageUrl,
          },
          reactions: reviewCommentReactionsMap.get(comment.id)?.reduce(
            (rec, reaction) => {
              rec[reaction.reaction] = (rec[reaction.reaction] || 0) + 1;
              return rec;
            },
            {} as Record<string, number>,
          ),
          replyCount: allComments.filter(
            (c) => c.parentCommentId === comment.id,
          ).length,
        })),
        commentCount: topLevelComments.length,
      };
    });
    return {
      data: reviewThreadsData,
      count: totalCount,
    };
  }
}
