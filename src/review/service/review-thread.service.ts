import {
  NotFoundException,
  ForbiddenException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { UserService } from 'src/user/service/user.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { ReviewRepository } from '../repository/review.repository';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { formatCreatedUserDetails } from '../util/review.util';
import { GetReviewThreadsOptions } from '../type/review-thread.type';
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

    const isHidden = review.createdBy === userId;

    const { threads: reviewThreads, count: totalCount } =
      await this.reviewThreadRepository.getReviewThreadsByReviewId(
        reviewId,
        isHidden,
        options,
      );

    if (totalCount == 0) {
      return {
        data: [],
        count: 0,
      };
    }

    // Filter to get only top-level comments
    const limit = 1;
    const threadIds = reviewThreads.map((thread) => thread.id);

    let messagesPromise;
    if (options?.includeMessage) {
      const messageIds = reviewThreads.map((thread) => thread.messageId);
      messagesPromise = this.scenarioSharedService.getMessagesByIds(messageIds);
    }

    const reviewCommentPromise = this.reviewCommentRepository
      .getCommentsForThreadIds(threadIds, isHidden)
      .then((results) => results.filter((result) => result.row_num <= limit));

    let reviewComments;
    let messages: ScenarioSessionMessages[];
    if (messagesPromise) {
      [messages, reviewComments] = await Promise.all([
        messagesPromise,
        reviewCommentPromise,
      ]);
    } else {
      reviewComments = await reviewCommentPromise;
    }

    const commentIds = reviewComments.map((comment) => comment.c_id);
    const userIds = [
      ...new Set([...reviewComments.map((comment) => comment.c_createdBy)]),
    ];

    const [reactions, users, myReactions, commentCount] = await Promise.all([
      this.reviewCommentReactionRepository.getReactionAndCountByCommentIds(
        commentIds,
      ),
      this.userService.getUsersByIds(userIds),
      this.reviewCommentReactionRepository.find({
        where: {
          reviewCommentId: In(commentIds),
          createdBy: userId,
        },
      }),
      this.reviewCommentRepository.getCommentCountsByThreadIds(
        threadIds,
        isHidden,
      ),
    ]);

    const commentCountMap = commentCount.reduce(
      (acc, { reviewThreadId, commentCount }) => {
        acc[reviewThreadId] = commentCount;
        return acc;
      },
      {} as Record<string, number>,
    );

    const myReactionsByCommentId = myReactions.reduce(
      (acc, reaction) => {
        acc[reaction.reviewCommentId] = reaction.reaction;
        return acc;
      },
      {} as Record<string, string>,
    );

    const reactionsByComment = reactions.reduce(
      (acc, { commentId, reaction, count }) => {
        if (!acc[commentId]) {
          acc[commentId] = {};
        }
        acc[commentId][reaction] = parseInt(count);
        return acc;
      },
      {} as Record<string, Record<string, number>>,
    );

    const userMap = new Map(
      users.map((user) => [user.id, formatCreatedUserDetails(user)]),
    );

    const commentsByThread = reviewComments.reduce(
      (acc, comment) => {
        if (!acc[comment.c_reviewThreadId]) {
          acc[comment.c_reviewThreadId] = [];
        }

        const user = userMap.get(comment.c_createdBy);
        acc[comment.c_reviewThreadId].push({
          id: comment.c_id,
          content: comment.c_content,
          createdAt: comment.c_createdAt,
          createdBy: user || {},
          reactions: reactionsByComment[comment.c_id] || {},
          myReaction: myReactionsByCommentId[comment.c_id] || null,
          hidden: comment.c_hidden,
          replyCount: parseInt(comment.reply_count, 10) || 0,
        });
        return acc;
      },
      {} as Record<string, any[]>,
    );

    const reviewThreadsData = reviewThreads.map((thread) => {
      const message = messages?.find(
        (message) => message.id === thread.messageId,
      );
      return {
        id: thread.id,
        selection: thread.selection,
        comments: commentsByThread[thread.id] || [],
        commentCount: commentCountMap[thread.id],
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
