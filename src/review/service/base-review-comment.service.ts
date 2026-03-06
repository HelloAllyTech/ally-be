import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import {
  CreateReviewCommentDto,
  CreateCommentResponseDto,
} from '../dto/create-comment.dto';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReviewThread } from '../entity/base-review-thread.entity';
import { BaseReview } from '../entity/base-review.entity';
import { BaseReviewCommentReaction } from '../entity/base-review-comment-reaction.entity';
import { BaseReviewCommentRepository } from '../repository/base-review-comment.repository';
import { ReviewStatus } from '../type/review.type';
import { Pagination, SuccessResponse } from 'src/common/type/common.type';
import { UserService } from 'src/user/service/user.service';
import { GetReviewRepliesResponseDto } from '../dto/review-replies-response.dto';
import { EDIT_COMMENT_TIME_LIMIT_MS } from '../constant/review.constant';
import { UpdateReviewCommentDto } from '../dto/update-review-comment.dto';
import { formatCreatedUserDetails } from '../util/review.util';
import { ToggleCommentVisibilityDto } from '../dto/toggle-comment-visibility.dto';
import { ReviewAccessValidator } from '../util/review-access-policy.util';
import { GetReviewCommentsResponseDto } from '../dto/review-comments-response.dto';

export abstract class BaseReviewCommentService<
  TReview extends BaseReview,
  TThread extends BaseReviewThread,
  TComment extends BaseReviewComment,
  TCommentReaction extends BaseReviewCommentReaction,
> {
  protected abstract readonly logger: LoggerService;
  protected abstract readonly dataSource: DataSource;
  protected abstract readonly reviewRepository: Repository<TReview>;
  protected abstract readonly reviewThreadRepository: Repository<TThread>;
  protected abstract readonly reviewCommentRepository: BaseReviewCommentRepository<
    TComment,
    TThread,
    TReview
  >;
  protected abstract readonly reviewCommentReactionRepository: Repository<TCommentReaction>;
  protected abstract readonly userService: UserService;
  protected abstract readonly reviewAccessValidator: ReviewAccessValidator;

  protected abstract getThreadEntityClass(): new () => TThread;
  protected abstract getCommentEntityClass(): new () => TComment;
  protected abstract getCommentReactionEntityClass(): new () => TCommentReaction;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onCommentAdded(review: TReview, comment: TComment): void {}
  protected onCommentRemoved(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    review: TReview,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    comment: TComment,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    commentReplies?: TComment[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    commentReactions?: TCommentReaction[],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    commentReplyReactions?: TCommentReaction[],
  ): void {}

  async addCommentToReview(
    reviewId: string,
    createReviewCommentDto: CreateReviewCommentDto,
  ): Promise<CreateCommentResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const review = await this.reviewRepository.findOne({
      where: {
        id: reviewId,
        status: ReviewStatus.IN_REVIEW,
        tenantId,
      } as any,
    });
    this.logger.info(`Adding comment to review: ${reviewId}`);

    if (!review) {
      this.logger.info(`Review not found: ${reviewId}`);
      throw new NotFoundException('Review not found');
    }
    await this.reviewAccessValidator.validateAccess(review, userId);

    if (!createReviewCommentDto.content.trim()) {
      this.logger.info(`Content cannot be empty: ${reviewId}`);
      throw new BadRequestException('Content cannot be empty');
    }

    if (createReviewCommentDto.parentCommentId) {
      this.logger.info(
        `Adding reply to parent comment: ${createReviewCommentDto.parentCommentId}`,
      );
      const parentComment = await this.reviewCommentRepository.findOne({
        where: {
          id: createReviewCommentDto.parentCommentId,
        } as any,
      });

      if (!parentComment) {
        throw new BadRequestException('Invalid parent comment');
      }

      const reply = this.reviewCommentRepository.create({
        reviewThreadId: parentComment.reviewThreadId,
        content: createReviewCommentDto.content,
        createdBy: Number(userId),
        parentCommentId: createReviewCommentDto.parentCommentId,
        tenantId,
      } as any) as unknown as TComment;
      await this.reviewCommentRepository.save(reply);
      this.logger.info(
        `Reply: ${(reply as any).id} added successfully for comment: ${parentComment.id}`,
      );

      this.onCommentAdded(review, reply);
      return {
        reply: {
          id: (reply as any).id,
          createdAt: (reply as any).createdAt,
        },
      };
    }

    if (createReviewCommentDto.threadId) {
      this.logger.info(
        `Adding comment to thread: ${createReviewCommentDto.threadId}`,
      );
      const thread = await this.reviewThreadRepository.findOne({
        where: {
          id: createReviewCommentDto.threadId,
        } as any,
      });
      if (!thread) {
        throw new NotFoundException('Review thread not found');
      }

      const comment = this.reviewCommentRepository.create({
        reviewThreadId: thread.id,
        content: createReviewCommentDto.content,
        createdBy: Number(userId),
        tenantId,
      } as any) as unknown as TComment;
      await this.reviewCommentRepository.save(comment);
      this.logger.info(
        `Comment: ${(comment as any).id} added successfully to thread: ${thread.id}`,
      );

      this.onCommentAdded(review, comment);

      return {
        comment: {
          id: (comment as any).id,
          createdAt: (comment as any).createdAt,
        },
      };
    }

    if (
      !createReviewCommentDto.threadId &&
      !createReviewCommentDto.parentCommentId
    ) {
      if (
        !createReviewCommentDto.messageId &&
        !createReviewCommentDto.selection
      ) {
        const thread = await this.reviewThreadRepository.findOne({
          where: {
            reviewId,
            tenantId,
            messageId: IsNull(),
            selection: IsNull(),
          } as any,
        });
        if (thread) {
          throw new BadRequestException(
            'Only one general discussion thread is allowed per review',
          );
        }
      }
      try {
        const ThreadEntity = this.getThreadEntityClass();
        const CommentEntity = this.getCommentEntityClass();

        const transactionOutput = await this.dataSource.transaction(
          async (entityManager) => {
            const thread = entityManager.create(ThreadEntity, {
              reviewId,
              messageId: createReviewCommentDto?.messageId,
              createdBy: Number(userId),
              selection: createReviewCommentDto?.selection,
              tenantId,
            } as any);
            await entityManager.save(ThreadEntity, thread);
            const comment = entityManager.create(CommentEntity, {
              reviewThreadId: (thread as any).id,
              content: createReviewCommentDto.content,
              createdBy: Number(userId),
              tenantId,
            } as any);
            await entityManager.save(CommentEntity, comment);
            return {
              result: {
                thread: {
                  id: (thread as any).id,
                  createdAt: (thread as any).createdAt,
                },
                comment: {
                  id: (comment as any).id,
                  createdAt: (comment as any).createdAt,
                },
              },
              comment,
            };
          },
        );

        const { result, comment } = transactionOutput;
        this.logger.info(
          `Thread: ${result.thread?.id} and comment: ${result.comment?.id} created successfully for messageId: ${createReviewCommentDto.messageId}`,
        );
        this.onCommentAdded(review, comment);

        return result;
      } catch (error) {
        this.logger.error(
          `Failed to add comment: ${error.message}`,
          error.stack,
        );
        throw new InternalServerErrorException(`Failed to add comment`);
      }
    }
    throw new BadRequestException('Invalid request');
  }

  async getReviewComments(
    threadId: string,
    options?: Pagination,
  ): Promise<GetReviewCommentsResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: threadId, tenantId } as any,
    });
    if (!thread) {
      throw new NotFoundException('Review thread not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId, tenantId } as any,
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    await this.reviewAccessValidator.validateAccess(review, userId);

    const isCommentVisible = review.createdBy === userId;

    const result = await this.reviewCommentRepository.getCommentsByThreadId(
      threadId,
      isCommentVisible,
      options,
    );

    if (result.comments.length === 0) {
      return { data: [], count: result.count };
    }

    const commentIds = result.comments.map((comment) => comment.comment_id);
    const creatorIds = [
      ...new Set(result.comments.map((comment) => comment.comment_createdBy)),
    ];

    const [reactions, users, myReactions] = await Promise.all([
      this.reviewCommentReactionRepository
        .createQueryBuilder('rcr')
        .select('rcr.reviewCommentId', 'commentId')
        .addSelect('rcr.reaction', 'reaction')
        .addSelect('COUNT(*)', 'count')
        .where('rcr.reviewCommentId IN (:...commentIds)', { commentIds })
        .groupBy('rcr.reviewCommentId')
        .addGroupBy('rcr.reaction')
        .getRawMany(),
      this.userService.getUsersByIds(creatorIds),
      this.reviewCommentReactionRepository.find({
        where: {
          reviewCommentId: In(commentIds),
          createdBy: userId,
        } as any,
      }),
    ]);

    const myReactionsByCommentId = myReactions.reduce(
      (acc, reaction: any) => {
        acc[reaction.reviewCommentId] = reaction.reaction;
        return acc;
      },
      {} as Record<string, string>,
    );

    const userMap = new Map(
      users.map((user) => [user.id, formatCreatedUserDetails(user)]),
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

    const data: GetReviewCommentsResponseDto['data'] = result.comments.map(
      (comment) => {
        const user = userMap.get(comment.comment_createdBy);
        return {
          id: comment.comment_id,
          content: comment.comment_content,
          createdAt: comment.comment_createdAt,
          createdBy: user!,
          myReaction: myReactionsByCommentId[comment.comment_id] || null,
          reactions: reactionsByComment[comment.comment_id] || {},
          replyCount: parseInt(comment.reply_count) || 0,
          hidden: comment.comment_hidden || false,
        };
      },
    );

    return {
      data,
      count: result.count,
    };
  }

  async getReviewCommentReplies(
    commentId: string,
    options?: Pagination,
  ): Promise<GetReviewRepliesResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const parentComment = await this.reviewCommentRepository.findOne({
      where: { id: commentId, tenantId } as any,
    });
    if (!parentComment) {
      throw new NotFoundException('Review comment not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: parentComment.reviewThreadId, tenantId } as any,
    });
    if (!thread) {
      throw new NotFoundException('Review thread not found');
    }
    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId, tenantId } as any,
    });

    if (!review) {
      throw new NotFoundException('Review not found');
    }
    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }
    await this.reviewAccessValidator.validateAccess(review, userId);

    const isCommentVisible = review.createdBy === userId;

    const [replies, count] =
      await this.reviewCommentRepository.getRepliesByCommentId(
        commentId,
        isCommentVisible,
        options,
      );

    if (replies.length === 0) {
      return { data: [], count: 0 };
    }

    const replyIds = replies.map((reply) => reply.id);
    const creatorIds = [...new Set(replies.map((reply) => reply.createdBy))];

    const [reactions, users, myReactions] = await Promise.all([
      this.reviewCommentReactionRepository
        .createQueryBuilder('rcr')
        .select('rcr.reviewCommentId', 'commentId')
        .addSelect('rcr.reaction', 'reaction')
        .addSelect('COUNT(*)', 'count')
        .where('rcr.reviewCommentId IN (:...commentIds)', {
          commentIds: replyIds,
        })
        .groupBy('rcr.reviewCommentId')
        .addGroupBy('rcr.reaction')
        .getRawMany(),
      this.userService.getUsersByIds(creatorIds),
      this.reviewCommentReactionRepository.find({
        where: {
          reviewCommentId: In(replyIds),
          createdBy: userId,
        } as any,
      }),
    ]);

    const myReactionsByReply = myReactions.reduce(
      (acc, reaction: any) => {
        acc[reaction.reviewCommentId] = reaction.reaction;
        return acc;
      },
      {} as Record<string, string>,
    );

    const userMap = new Map(
      users.map((user) => [user.id, formatCreatedUserDetails(user)]),
    );

    const reactionsByReply = reactions.reduce(
      (acc, { commentId, reaction, count }) => {
        if (!acc[commentId]) {
          acc[commentId] = {};
        }
        acc[commentId][reaction] = parseInt(count);
        return acc;
      },
      {} as Record<string, Record<string, number>>,
    );

    const data = replies.map((reply) => {
      const user = userMap.get(reply.createdBy);
      return {
        id: reply.id,
        content: reply.content,
        createdAt: reply.createdAt,
        createdBy: user!,
        reactions: reactionsByReply[reply.id] || {},
        myReaction: myReactionsByReply[reply.id] || null,
        hidden: reply.hidden || false,
      };
    });
    return { data, count };
  }

  async editReviewComment(
    commentId: string,
    updateReviewCommentDto: UpdateReviewCommentDto,
  ): Promise<SuccessResponse> {
    const { content } = updateReviewCommentDto;
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const comment = await this.reviewCommentRepository.findOne({
      where: { id: commentId, createdBy: userId } as any,
    });

    if (!comment) {
      throw new NotFoundException('Review comment not found');
    }
    const now = new Date();
    if (
      now.getTime() - comment.createdAt.getTime() >
      EDIT_COMMENT_TIME_LIMIT_MS
    ) {
      throw new BadRequestException('Cannot edit this comment');
    }

    comment.content = content;
    await this.reviewCommentRepository.save(comment);
    return { success: true };
  }

  async deleteReviewComment(commentId: string): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const comment = await this.reviewCommentRepository.findOne({
      where: { id: commentId, createdBy: userId } as any,
    });

    if (!comment) {
      throw new NotFoundException('Review comment not found');
    }

    const parentCommentId = comment?.parentCommentId;
    const CommentReactionEntity = this.getCommentReactionEntityClass();
    const CommentEntity = this.getCommentEntityClass();
    const ThreadEntity = this.getThreadEntityClass();

    if (parentCommentId) {
      try {
        await this.dataSource.transaction(async (entityManager) => {
          await entityManager.getRepository(CommentReactionEntity).softDelete({
            reviewCommentId: commentId,
          } as any);
          await entityManager
            .getRepository(CommentEntity)
            .softDelete(commentId);
        });

        this.emitCommentDeletedEvent(comment);
        return { success: true };
      } catch (error) {
        this.logger.error(`Failed to delete reply: ${error.message}`);
        throw new InternalServerErrorException(`Failed to delete reply`);
      }
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId } as any,
    });
    if (!thread) {
      this.logger.error(`Review thread not found for comment: ${commentId}`);
      throw new NotFoundException('Review thread not found for this comment');
    }

    const commentCount = await this.reviewCommentRepository.count({
      where: { reviewThreadId: thread.id } as any,
    });

    const replies = await this.reviewCommentRepository.find({
      where: { parentCommentId: commentId } as any,
    });

    try {
      await this.dataSource.transaction(async (entityManager) => {
        if (replies.length > 0) {
          await entityManager.getRepository(CommentEntity).softDelete({
            parentCommentId: commentId,
          } as any);

          await entityManager.getRepository(CommentReactionEntity).softDelete({
            reviewCommentId: In(replies.map((reply) => reply.id)),
          } as any);
        }
        await entityManager.getRepository(CommentReactionEntity).softDelete({
          reviewCommentId: commentId,
        } as any);
        if (commentCount <= 1) {
          await entityManager.getRepository(ThreadEntity).softDelete(thread.id);
        }
        await entityManager.getRepository(CommentEntity).softDelete(commentId);
      });
    } catch (error) {
      this.logger.error(`Failed to delete comment: ${error.message}`);
      throw new InternalServerErrorException(`Failed to delete comment`);
    }

    this.logger.info(`Comment deleted successfully: ${commentId}`);

    this.emitCommentDeletedEvent(comment);

    return { success: true };
  }

  private async emitCommentDeletedEvent(comment: TComment) {
    if (!comment) return;
    const commentThread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId } as any,
      withDeleted: true,
    });
    if (!commentThread) return;
    const review = await this.reviewRepository.findOne({
      where: { id: commentThread.reviewId } as any,
      withDeleted: true,
    });
    if (!review) return;
    const commentReactions = await this.reviewCommentReactionRepository.find({
      where: { reviewCommentId: comment.id } as any,
      withDeleted: true,
    });
    const commentReplies = await this.reviewCommentRepository.find({
      where: { parentCommentId: comment.id } as any,
      withDeleted: true,
    });
    let commentReplyReactions: TCommentReaction[] = [];
    if (commentReplies.length > 0) {
      commentReplyReactions = await this.reviewCommentReactionRepository.find({
        where: {
          reviewCommentId: In(commentReplies.map((reply) => reply.id)),
        } as any,
        withDeleted: true,
      });
    }

    this.onCommentRemoved(
      review,
      comment,
      commentReplies,
      commentReactions,
      commentReplyReactions,
    );
  }

  async toggleCommentVisibility(
    commentId: string,
    toggleCommentVisibilityDto: ToggleCommentVisibilityDto,
  ): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    this.logger.info(`Toggling comment visibility: ${commentId}`);
    const comment = await this.reviewCommentRepository.findOne({
      where: { id: commentId, tenantId } as any,
    });
    if (!comment) {
      this.logger.error(`Comment not found: ${commentId}`);
      throw new NotFoundException('Comment not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId, tenantId } as any,
    });
    if (!thread) {
      this.logger.error(`Thread not found: ${comment.reviewThreadId}`);
      throw new NotFoundException('Thread not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId } as any,
    });
    if (!review) {
      this.logger.error(`Review not found: ${thread.reviewId}`);
      throw new NotFoundException('Review not found');
    }

    if (review.createdBy !== userId) {
      this.logger.error(`User not allowed to access this review: ${userId}`);
      throw new ForbiddenException('You are not allowed to access this review');
    }

    if (comment.parentCommentId) {
      this.logger.info(`Updating reply visibility: ${commentId}`);
      await this.reviewCommentRepository.update(commentId, {
        hidden: toggleCommentVisibilityDto.hidden,
      } as any);
      return { success: true };
    }

    if (!comment.parentCommentId) {
      try {
        const CommentEntity = this.getCommentEntityClass();
        return await this.dataSource.transaction(async (entityManager) => {
          const commentRepo = entityManager.getRepository(CommentEntity);

          await commentRepo.update(
            { id: commentId } as any,
            { hidden: toggleCommentVisibilityDto.hidden } as any,
          );

          await commentRepo.update(
            { parentCommentId: commentId } as any,
            { hidden: toggleCommentVisibilityDto.hidden } as any,
          );
          this.logger.info(
            `Comment and replies visibility updated: ${commentId}`,
          );
          return { success: true };
        });
      } catch (error) {
        this.logger.error(`Failed hide comment: ${error.message}`);
        throw new InternalServerErrorException(
          `Failed to change visibility of comment`,
        );
      }
    }
    throw new BadRequestException('Invalid request');
  }

  async getGeneralReviewComments(
    reviewId: string,
    options?: Pagination,
  ): Promise<GetReviewCommentsResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const generalCommentsThread = await this.reviewThreadRepository.findOne({
      where: {
        reviewId,
        messageId: IsNull(),
        selection: IsNull(),
        tenantId,
      } as any,
    });
    if (!generalCommentsThread) {
      return { data: [], count: 0 };
    }

    return this.getReviewComments(generalCommentsThread.id, options);
  }
}
