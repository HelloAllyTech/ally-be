import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  CreateReviewCommentDto,
  CreateCommentResponseDto,
} from '../dto/create-comment.dto';
import { ReviewComment } from '../entity/review-comment.entity';
import { ReviewThread } from '../entity/review-thread.entity';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewStatus } from '../type/review.type';
import { ReviewRepository } from '../repository/review.repository';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { Pagination, SuccessResponse } from 'src/common/type/common.type';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { UserService } from 'src/user/service/user.service';
import { GetReviewRepliesResponseDto } from '../dto/review-replies-response.dto';
import {
  DELETE_COMMENT_TIME_LIMIT_MS,
  EDIT_COMMENT_TIME_LIMIT_MS,
} from '../constant/review.constant';
import { UpdateReviewCommentDto } from '../dto/update-review-comment.dto';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';
import { formatCreatedUserDetails } from '../util/review.util';
import { ToggleCommentVisibilityDto } from '../dto/toggle-comment-visibility.dto';
import { CommunitySharedService } from 'src/community/service/community-shared.service';
import { ReviewEvents } from '../type/review-event.type';

@Injectable()
export class ReviewCommentService {
  private readonly logger = LoggerService.getInstance(
    ReviewCommentService.name,
  );
  constructor(
    private readonly dataSource: DataSource,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly permissionValidator: PermissionValidator,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly userService: UserService,
    private readonly communitySharedService: CommunitySharedService,
    private eventEmitter: EventEmitter2,
  ) {}

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
      },
    });
    this.logger.info(`Adding comment to review: ${reviewId}`);

    if (!review) {
      this.logger.info(`Review not found: ${reviewId}`);
      throw new NotFoundException('Review not found');
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
      (isReviewer && review.tenantId !== ExecutionManager.getTenantId()) ||
      (!isReviewer && isLearner && review.createdBy !== userId)
    ) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    if (!createReviewCommentDto.content.trim()) {
      this.logger.info(`Content cannot be empty: ${reviewId}`);
      throw new BadRequestException('Content cannot be empty');
    }

    // If parent comment is present, it is a reply, so we need to add the reply
    if (createReviewCommentDto.parentCommentId) {
      this.logger.info(
        `Adding reply to parent comment: ${createReviewCommentDto.parentCommentId}`,
      );
      const parentComment = await this.reviewCommentRepository.findOne({
        where: {
          id: createReviewCommentDto.parentCommentId,
        },
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
      });
      await this.reviewCommentRepository.save(reply);
      this.logger.info(
        `Reply: ${reply.id} added successfully for comment: ${parentComment.id}`,
      );

      if (review.createdBy !== userId) {
        this.communitySharedService.incrementCommentScore(userId, tenantId);
      }

      this.eventEmitter.emit(ReviewEvents.REVIEW_COMMENT_ADDED, {
        review,
        comment: reply,
      });
      return {
        reply: {
          id: reply.id,
          createdAt: reply.createdAt,
        },
      };
    }

    // If threadId is present, it is a new thread, so we need to add the comment to the thread
    if (createReviewCommentDto.threadId) {
      this.logger.info(
        `Adding comment to thread: ${createReviewCommentDto.threadId}`,
      );
      const thread = await this.reviewThreadRepository.findOne({
        where: {
          id: createReviewCommentDto.threadId,
        },
      });
      if (!thread) {
        throw new NotFoundException('Review thread not found');
      }

      const comment = this.reviewCommentRepository.create({
        reviewThreadId: thread.id,
        content: createReviewCommentDto.content,
        createdBy: Number(userId),
        tenantId,
      });
      await this.reviewCommentRepository.save(comment);
      this.logger.info(
        `Comment: ${comment.id} added successfully to thread: ${thread.id}`,
      );

      if (review.createdBy !== userId) {
        this.communitySharedService.incrementCommentScore(userId, tenantId);
      }
      this.eventEmitter.emit(ReviewEvents.REVIEW_COMMENT_ADDED, {
        review,
        comment,
      });

      return {
        comment: {
          id: comment.id,
          createdAt: comment.createdAt,
        },
      };
    }

    // If threadId and parentCommentId are not present, it is a new thread, so we need to create a new thread and comment
    if (
      !createReviewCommentDto.threadId &&
      !createReviewCommentDto.parentCommentId
    ) {
      if (!createReviewCommentDto.messageId) {
        throw new BadRequestException('messageId required for new threads');
      }
      if (!createReviewCommentDto.selection) {
        throw new BadRequestException('selection required for new threads');
      }
      this.logger.info(
        `Creating new thread for messageId: ${createReviewCommentDto.messageId}`,
      );
      try {
        const result = await this.dataSource.transaction(
          async (entityManager) => {
            const thread = entityManager.create(ReviewThread, {
              reviewId,
              messageId: createReviewCommentDto.messageId,
              createdBy: Number(userId),
              selection: createReviewCommentDto.selection,
              tenantId,
            });
            await entityManager.save(ReviewThread, thread);
            const comment = entityManager.create(ReviewComment, {
              reviewThreadId: thread.id,
              content: createReviewCommentDto.content,
              createdBy: Number(userId),
              tenantId,
            });
            await entityManager.save(ReviewComment, comment);
            this.eventEmitter.emit(ReviewEvents.REVIEW_COMMENT_ADDED, {
              review,
              comment,
            });
            return {
              thread: {
                id: thread.id,
                createdAt: thread.createdAt,
              },
              comment: {
                id: comment.id,
                createdAt: comment.createdAt,
              },
            };
          },
        );

        this.logger.info(
          `Thread: ${result.thread?.id} and comment: ${result.comment?.id} created successfully for messageId: ${createReviewCommentDto.messageId}`,
        );

        if (review.createdBy !== userId) {
          this.communitySharedService.incrementCommentScore(userId, tenantId);
        }

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

  async getReviewComments(threadId: string, options?: Pagination) {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: threadId, tenantId },
    });
    if (!thread) {
      throw new NotFoundException('Review thread not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId, tenantId },
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

    const isHidden = review.createdBy === userId;

    const result = await this.reviewCommentRepository.getCommentsByThreadId(
      threadId,
      isHidden,
      options,
    );

    if (result.comments.length === 0) {
      return { data: [], count: result.count };
    }

    const commentIds = result.comments.map((comment) => comment.c_id);
    const creatorIds = [
      ...new Set(result.comments.map((comment) => comment.c_createdBy)),
    ];

    const [reactions, users] = await Promise.all([
      this.reviewCommentReactionRepository.getReactionAndCountByCommentIds(
        commentIds,
      ),
      this.userService.getUsersByIds(creatorIds),
    ]);

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

    // Map comments with reactions and user data
    const data = result.comments.map((comment) => {
      const user = userMap.get(comment.c_createdBy);
      return {
        id: comment.c_id,
        content: comment.c_content,
        createdAt: comment.c_createdAt,
        createdBy: user,
        reactions: reactionsByComment[comment.c_id] || {},
        replyCount: parseInt(comment.reply_count) || 0,
        hidden: comment.c_hidden || false,
      };
    });

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
      where: { id: commentId, tenantId },
    });
    if (!parentComment) {
      throw new NotFoundException('Review comment not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: parentComment.reviewThreadId, tenantId },
    });
    if (!thread) {
      throw new NotFoundException('Review thread not found');
    }
    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId, tenantId },
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

    const isHidden = review.createdBy === userId;

    const [replies, count] =
      await this.reviewCommentRepository.getRepliesByCommentId(
        commentId,
        isHidden,
        options,
      );

    if (replies.length === 0) {
      return { data: [], count: 0 };
    }

    const replyIds = replies.map((reply) => reply.id);
    const creatorIds = [...new Set(replies.map((reply) => reply.createdBy))];

    const [reactions, users] = await Promise.all([
      this.reviewCommentReactionRepository.getReactionAndCountByCommentIds(
        replyIds,
      ),
      this.userService.getUsersByIds(creatorIds),
    ]);

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
      where: { id: commentId, createdBy: userId },
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

  async deleteReviewComment(
    commentId: string,
    tenantId: string,
  ): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const comment = await this.reviewCommentRepository.findOne({
      where: { id: commentId, createdBy: userId },
    });

    if (!comment) {
      throw new NotFoundException('Review comment not found');
    }

    const now = new Date();
    if (
      now.getTime() - comment.createdAt.getTime() >
      DELETE_COMMENT_TIME_LIMIT_MS
    ) {
      throw new BadRequestException('Cannot delete this comment');
    }

    // Get the thread and review to check ownership for score decrement
    const commentThread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId },
    });
    let reviewCreatedBy: number | null = null;
    if (commentThread) {
      const review = await this.reviewRepository.findOne({
        where: { id: commentThread.reviewId },
      });
      if (review) {
        reviewCreatedBy = review.createdBy;
      }
    }

    const parentCommentId = comment?.parentCommentId;

    if (parentCommentId) {
      try {
        // if parent comment is present, it is a reply, so we need to delete the reply and its reactions
        await this.dataSource.transaction(async (entityManager) => {
          // Delete all reactions of this comment
          await entityManager.getRepository(ReviewCommentReaction).softDelete({
            reviewCommentId: commentId,
          });
          // Delete this comment
          await entityManager
            .getRepository(ReviewComment)
            .softDelete(commentId);
        });

        if (reviewCreatedBy !== null && reviewCreatedBy !== userId) {
          this.communitySharedService.decrementCommentScore(userId, tenantId);
        }

        return { success: true };
      } catch (error) {
        this.logger.error(`Failed to delete reply: ${error.message}`);
        throw new InternalServerErrorException(`Failed to delete reply`);
      }
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId },
    });
    if (!thread) {
      this.logger.error(`Review thread not found for comment: ${commentId}`);
      throw new NotFoundException('Review thread not found for this comment');
    }

    // Count all comments in this thread
    const commentCount = await this.reviewCommentRepository.count({
      where: { reviewThreadId: thread.id },
    });

    const replies = await this.reviewCommentRepository.find({
      where: { parentCommentId: commentId },
    });

    try {
      await this.dataSource.transaction(async (entityManager) => {
        if (replies.length > 0) {
          // Delete all replies of this comment
          await entityManager.getRepository(ReviewComment).softDelete({
            parentCommentId: commentId,
          });

          // Delete all reactions of the replies
          await entityManager.getRepository(ReviewCommentReaction).softDelete({
            reviewCommentId: In(replies.map((reply) => reply.id)),
          });
        }
        // Delete all reactions of this comment
        await entityManager.getRepository(ReviewCommentReaction).softDelete({
          reviewCommentId: commentId,
        });
        if (commentCount <= 1) {
          // Delete thread if it has no other comments
          await entityManager.getRepository(ReviewThread).softDelete(thread.id);
        }
        await entityManager.getRepository(ReviewComment).softDelete(commentId);
      });
    } catch (error) {
      this.logger.error(`Failed to delete comment: ${error.message}`);
      throw new InternalServerErrorException(`Failed to delete comment`);
    }

    this.logger.info(`Comment deleted successfully: ${commentId}`);

    if (reviewCreatedBy !== null && reviewCreatedBy !== userId) {
      this.communitySharedService.decrementCommentScore(userId, tenantId);
    }

    return { success: true };
  }

  async toggleCommentVisibility(
    commentId: string,
    toggleCommentVisibilityDto: ToggleCommentVisibilityDto,
  ) {
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
      where: { id: commentId, tenantId },
    });
    if (!comment) {
      this.logger.error(`Comment not found: ${commentId}`);
      throw new NotFoundException('Comment not found');
    }

    const thread = await this.reviewThreadRepository.findOne({
      where: { id: comment.reviewThreadId, tenantId },
    });
    if (!thread) {
      this.logger.error(`Thread not found: ${comment.reviewThreadId}`);
      throw new NotFoundException('Thread not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id: thread.reviewId },
    });
    if (!review) {
      this.logger.error(`Review not found: ${thread.reviewId}`);
      throw new NotFoundException('Review not found');
    }

    if (review.createdBy !== userId) {
      this.logger.error(`User not allowed to access this review: ${userId}`);
      throw new ForbiddenException('You are not allowed to access this review');
    }

    // If it is a reply, update the reply
    if (comment.parentCommentId) {
      this.logger.info(`Updating reply visibility: ${commentId}`);
      await this.reviewCommentRepository.update(commentId, {
        hidden: toggleCommentVisibilityDto.hidden,
      });
      return { success: true };
    }

    // If it is a top-level comment, update the comment and its replies
    if (!comment.parentCommentId) {
      try {
        await this.dataSource.transaction(async (entityManager) => {
          const commentRepo = entityManager.getRepository(ReviewComment);

          // Update the comment itself
          await commentRepo.update(
            { id: commentId },
            { hidden: toggleCommentVisibilityDto.hidden },
          );

          // If it's a top-level comment, update all its replies
          await commentRepo.update(
            { parentCommentId: commentId },
            { hidden: toggleCommentVisibilityDto.hidden },
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
}
