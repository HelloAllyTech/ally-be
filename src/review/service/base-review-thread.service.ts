import { NotFoundException, BadRequestException } from '@nestjs/common';
import { In, Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { UserService } from 'src/user/service/user.service';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { BaseReviewThread } from '../entity/base-review-thread.entity';
import { BaseReview } from '../entity/base-review.entity';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReviewCommentReaction } from '../entity/base-review-comment-reaction.entity';
import { BaseReviewThreadRepository } from '../repository/base-review-thread.repository';
import { BaseReviewCommentRepository } from '../repository/base-review-comment.repository';
import { formatCreatedUserDetails } from '../util/review.util';
import { GetReviewThreadsOptions } from '../type/review-thread.type';
import { ReviewAccessValidator } from '../util/review-access-policy.util';

export abstract class BaseReviewThreadService<
  TReview extends BaseReview,
  TThread extends BaseReviewThread,
  TComment extends BaseReviewComment,
  TCommentReaction extends BaseReviewCommentReaction,
> {
  protected abstract readonly reviewRepository: Repository<TReview>;
  protected abstract readonly reviewThreadRepository: BaseReviewThreadRepository<
    TThread,
    TComment,
    TReview
  >;
  protected abstract readonly reviewCommentRepository: BaseReviewCommentRepository<
    TComment,
    TThread,
    TReview
  >;
  protected abstract readonly reviewCommentReactionRepository: Repository<TCommentReaction>;
  protected abstract readonly userService: UserService;
  protected abstract readonly reviewAccessValidator: ReviewAccessValidator;

  protected abstract getMessagesByIds(messageIds: number[]): Promise<any[]>;

  async getReviewThreads(
    reviewId: string,
    options?: GetReviewThreadsOptions,
  ): Promise<ReviewThreadsResponseDto> {
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

    const limit = 1;
    const threadIds = reviewThreads.map((thread) => thread.id);

    let messagesPromise: Promise<any[]> | undefined;
    if (options?.includeMessage) {
      const messageIds = reviewThreads.map((thread) => thread.messageId);
      messagesPromise = this.getMessagesByIds(messageIds as number[]);
    }

    const reviewCommentPromise = this.reviewCommentRepository
      .getCommentsForThreadIds(threadIds, isCommentVisible)
      .then((results) => results.filter((result) => result.row_num <= limit));

    let reviewComments;
    let messages: any[];
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
      this.reviewCommentReactionRepository
        .createQueryBuilder('rcr')
        .select('rcr.reviewCommentId', 'commentId')
        .addSelect('rcr.reaction', 'reaction')
        .addSelect('COUNT(*)', 'count')
        .where('rcr.reviewCommentId IN (:...commentIds)', {
          commentIds: commentIds.length ? commentIds : [''],
        })
        .groupBy('rcr.reviewCommentId')
        .addGroupBy('rcr.reaction')
        .getRawMany(),
      this.userService.getUsersByIds(userIds),
      this.reviewCommentReactionRepository.find({
        where: {
          reviewCommentId: In(commentIds.length ? commentIds : ['']),
          createdBy: userId,
        } as any,
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
      (acc, reaction: any) => {
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
