import {
  NotFoundException,
  ForbiddenException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { User } from 'src/user/entity/user.entity';
import { UserService } from 'src/user/service/user.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { ReviewRepository } from '../repository/review.repository';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { formatCreatedUserDetails } from '../util/review.util';
import { GetReviewThreadsOptions } from '../type/review.type';
import { ScenarioSessionMessages } from 'src/learn/entity/scenario-session-messages.entity';

@Injectable()
export class ReviewThreadService {
  constructor(
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly permissionValidator: PermissionValidator,
    private readonly userService: UserService,
    private readonly scenarioSharedService: ScenarioSharedService,
  ) {}

  async getReviewThreads(
    reviewId: string,
    options?: GetReviewThreadsOptions,
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

    let messagesPromise;
    if (options?.includeMessage) {
      const messageIds = reviewThreads.map((thread) => thread.messageId);
      messagesPromise = this.scenarioSharedService.getMessagesByIds(messageIds);
    }

    const reviewCommentsPromise = this.reviewCommentRepository.find({
      where: { reviewThreadId: In(reviewThreads.map((thread) => thread.id)) },
    });

    let reviewComments;
    let messages: ScenarioSessionMessages[];
    if (messagesPromise) {
      [messages, reviewComments] = await Promise.all([
        messagesPromise,
        reviewCommentsPromise,
      ]);
    } else {
      reviewComments = await reviewCommentsPromise;
    }

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

      const message = messages?.find(
        (message) => message.id === thread.messageId,
      );
      return {
        id: thread.id,
        selection: thread.selection,
        comments: topLevelComments.map((comment) => ({
          id: comment.id,
          content: comment.content,
          createdAt: comment.createdAt,
          createdBy: formatCreatedUserDetails(usersMap.get(comment.createdBy)!),
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
        ...(options?.includeMessage && message
          ? {
              message: {
                id: message?.id,
                content: message?.content,
              },
            }
          : {}),
      };
    });
    return {
      data: reviewThreadsData,
      count: totalCount,
    };
  }
}
