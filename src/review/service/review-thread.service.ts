import {
  NotFoundException,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { In } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { UserService } from 'src/user/service/user.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { ReviewRepository } from '../repository/review.repository';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { formatCreatedUserDetails } from '../util/review.util';
import { GetReviewThreadsOptions } from '../type/review-thread.type';
import { ScenarioSessionMessages } from 'src/learn/entity/scenario-session-messages.entity';
import { ReviewAccessValidator } from '../util/review-access-policy.util';

@Injectable()
export class ReviewThreadService {
  constructor(
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly userService: UserService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly reviewAccessValidator: ReviewAccessValidator,
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

    await this.reviewAccessValidator.validateAccess(review, userId);

    const isCommentVisible = review.createdBy === userId;

    const { threads: reviewThreads, count: totalCount } =
      await this.reviewThreadRepository.getReviewThreadsByReviewId(
        reviewId,
        isCommentVisible,
        options,
      );

    if (totalCount === 0 || reviewThreads.length === 0) {
      return {
        data: [],
        count: totalCount,
      };
    }

    // Filter to get only top-level comments
    const limit = 1;
    const threadIds = reviewThreads.map((thread) => thread.id);

    let messagesPromise;
    if (options?.includeMessage) {
      const messageIds = reviewThreads.map((thread) => thread.messageId);
      messagesPromise = this.scenarioSharedService.getMessagesByIds(
        messageIds as number[],
      );
    }

    const reviewCommentPromise = this.reviewCommentRepository
      .getCommentsForThreadIds(threadIds, isCommentVisible)
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

    const commentIds = reviewComments.map((comment) => comment.comment_id);
    const userIds = [
      ...new Set([
        ...reviewComments.map((comment) => comment.comment_createdBy),
      ]),
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
        isCommentVisible,
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
        if (!acc[comment.comment_reviewThreadId]) {
          acc[comment.comment_reviewThreadId] = [];
        }

        const user = userMap.get(comment.comment_createdBy);
        acc[comment.comment_reviewThreadId].push({
          id: comment.comment_id,
          content: comment.comment_content,
          createdAt: comment.comment_createdAt,
          createdBy: user || {},
          reactions: reactionsByComment[comment.comment_id] || {},
          myReaction: myReactionsByCommentId[comment.comment_id] || null,
          hidden: comment.comment_hidden,
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
