import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Review } from '../entity/review.entity';
import { ReviewRepository } from '../repository/review.repository';
import {
  CreateReviewDto,
  CreateReviewResponseDto,
} from '../dto/create-review.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { Pagination, SuccessResponse } from 'src/common/type/common.type';
import { UpdateReviewDto } from '../dto/update-review.dto';
import {
  GetReviews,
  GetReviewsOptions,
  Reviews,
  ReviewStatus,
} from '../type/review.type';
import { UserService } from 'src/user/service/user.service';
import { ReviewReactionRepository } from '../repository/review-reaction.repository';
import { GetReviewResponseDto } from '../dto/get-review-response.dto';
import { LoggerService } from 'src/logger/logger.service';
import {
  formatCreatedUserDetails,
  getSessionDurationInSeconds,
} from '../util/review.util';
import { In, IsNull, Not } from 'typeorm';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { GetReviewMessagesResponseDto } from '../dto/review-messages-response.dto';
import { ReviewAccessValidator } from '../util/review-access-policy.util';
import { NOTE_EDIT_WINDOW_MS } from '../constant/review.constant';
import { TIME } from 'src/common/constants/time.constants';

@Injectable()
export class ReviewService {
  private readonly logger = LoggerService.getInstance(ReviewService.name);
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewReactionRepository: ReviewReactionRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly userService: UserService,
    private readonly reviewAccessValidator: ReviewAccessValidator,
  ) {}

  async createReview(
    createReviewDto: CreateReviewDto,
  ): Promise<CreateReviewResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    const tenantId = ExecutionManager.getTenantId();
    if (!userId) {
      throw new BadRequestException('User or tenant not found');
    }
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }
    const scenarioSession =
      await this.scenarioSharedService.getScenarioSessionForUser(
        createReviewDto.scenarioSessionId,
        userId,
      );
    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }
    const existingReview = await this.reviewRepository.findOne({
      where: {
        scenarioSessionId: createReviewDto.scenarioSessionId,
      },
    });
    if (existingReview) {
      throw new ConflictException('Review already exists');
    }

    const review = this.reviewRepository.create({
      ...createReviewDto,
      createdBy: userId,
      tenantId: tenantId,
    });
    const savedReview = await this.reviewRepository.save(review);

    return { id: savedReview.id };
  }

  async updateReview(
    id: string,
    updateReviewDto: UpdateReviewDto,
  ): Promise<SuccessResponse> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User not found');
    }
    const review = await this.reviewRepository.findOne({
      where: { id, createdBy: Number(userId) },
    });
    if (!review) {
      throw new BadRequestException('Review not found');
    }

    const hasNoteUpdated = updateReviewDto.note !== undefined;
    if (hasNoteUpdated) {
      const elapsed = new Date().getTime() - review.createdAt.getTime();
      if (elapsed > NOTE_EDIT_WINDOW_MS) {
        throw new ForbiddenException(
          `Note can only be edited within ${NOTE_EDIT_WINDOW_MS / TIME.MINUTE_IN_MS} minutes of review creation`,
        );
      }
    }

    const updates: Partial<Review> = { ...review };

    if (updateReviewDto.status !== undefined) {
      updates.status = updateReviewDto.status;
    }
    if (hasNoteUpdated) {
      updates.note = updateReviewDto.note;
      updates.noteEditedAt = new Date();
    }

    const updatedReview = this.reviewRepository.create(updates);
    await this.reviewRepository.save(updatedReview);
    return { success: true };
  }

  async getAllReviews(options: GetReviewsOptions): Promise<any> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User or tenant not found');
    }
    const result = await this.reviewRepository.getAllReviews(
      options,
      tenantId,
      userId,
    );

    if (result.reviews.length === 0) return { data: [], count: result.count };

    const reviewIds = result.reviews.map((review: Reviews) => review.id);

    const [reactions, comments] = await Promise.all([
      this.reviewReactionRepository.getReactionsByReviewIds(reviewIds),
      this.reviewThreadRepository.getCommentsCountByReviewIds(
        reviewIds,
        userId,
      ),
    ]);

    const data = this.formatReviewListResponse({
      reviews: result.reviews,
      count: result.count,
      reactions,
      comments,
    });
    return { data, count: result.count };
  }

  async getReviewById(id: string): Promise<GetReviewResponseDto> {
    const userId = Number(ExecutionManager.getUserId());

    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const review = await this.reviewRepository.findOne({
      where: { id, tenantId },
    });

    if (!review) {
      throw new BadRequestException('Review not found');
    }

    if (review.status === ReviewStatus.HIDDEN && review.createdBy !== userId) {
      throw new ForbiddenException('You are not allowed to access this review');
    }

    await this.reviewAccessValidator.validateAccess(review, userId);

    const scenarioSession =
      await this.scenarioSharedService.getScenarioSessionById(
        review.scenarioSessionId,
      );

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    const [
      user,
      scenario,
      comments,
      reactions,
      myReaction,
      generalCommentsThread,
    ] = await Promise.all([
      this.userService.get(review.createdBy),
      this.scenarioSharedService.getScenarioById(scenarioSession.scenarioId),
      this.reviewThreadRepository.getCommentsCountByReviewIds(
        [review.id],
        userId,
      ),
      this.reviewReactionRepository.getReactionsByReviewIds([review.id]),
      this.reviewReactionRepository.findOne({
        where: { reviewId: review.id, createdBy: userId },
      }),
      this.reviewThreadRepository.findOne({
        where: {
          reviewId: review.id,
          messageId: IsNull(),
          selection: IsNull(),
        },
      }),
    ]);

    const updatedReactions = reactions.reduce(
      (acc, reaction) => {
        acc[reaction.reaction] = Number(reaction.count);
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      id: review.id,
      scenario: {
        title: scenario?.title,
        createdAt: scenario?.createdAt,
        name: scenario?.metadata?.name,
        description: scenario?.description,
        coverImageUrl: scenario?.coverImageUrl,
        coverVideoUrl: scenario?.coverVideoUrl,
      },
      scenarioSession: {
        id: scenarioSession.id,
        duration: getSessionDurationInSeconds(
          scenarioSession.startedAt!,
          scenarioSession.endedAt!,
        ),
        createdAt: scenarioSession.createdAt,
      },
      commentsCount: comments.length > 0 ? Number(comments[0].count) : 0,
      createdBy: formatCreatedUserDetails(user!),
      reactions: updatedReactions,
      myReaction: myReaction?.reaction ?? null,
      ...(userId === review.createdBy && { reviewStatus: review.status }),
      generalCommentsThreadId: generalCommentsThread?.id ?? null,
      note: review.note ?? null,
      noteEditedAt: review.noteEditedAt ?? null,
    };
  }

  private formatReviewListResponse(result: GetReviews) {
    const reactionsByReviewId: Record<string, Record<string, number>> = {};
    const commentsByReviewId: Record<string, number> = {};

    for (const reaction of result.reactions) {
      const reviewId = reaction.reviewId;
      reactionsByReviewId[reviewId] ??= {};
      reactionsByReviewId[reviewId][reaction.reaction] = Number(reaction.count);
    }

    for (const comment of result.comments) {
      commentsByReviewId[comment.reviewId] = Number(comment.count);
    }

    const data = result.reviews.map((review: Reviews) => ({
      id: review.id,
      createdAt: review.createdAt,
      scenario: review.scenario
        ? {
            title: review.scenario.title,
            createdAt: review.scenario.createdAt,
            description: review.scenario.description,
            coverImageUrl: review.scenario.coverImageUrl,
            coverVideoUrl: review.scenario.coverVideoUrl,
          }
        : {},
      scenarioSession: review.scenarioSession
        ? {
            createdAt: review.scenarioSession.createdAt,
            duration: getSessionDurationInSeconds(
              review.scenarioSession.startedAt!,
              review.scenarioSession.endedAt!,
            ),
          }
        : {},
      commentsCount: commentsByReviewId[review.id] ?? 0,
      reactions: reactionsByReviewId[review.id] ?? {},
      createdBy: formatCreatedUserDetails(review.createdBy),
      note: review.note ?? null,
      noteEditedAt: review.noteEditedAt ?? null,
    }));

    return data;
  }

  async getReviewMessages(
    reviewId: string,
    options?: Pagination,
  ): Promise<GetReviewMessagesResponseDto> {
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

    const transcript =
      await this.scenarioSharedService.getMessagesByScenarioSessionId(
        review.scenarioSessionId,
        { ...options },
      );

    if (transcript.messages.length === 0) {
      return { data: [], count: transcript.count };
    }

    const messageIds = transcript.messages.map((message) => message.id);

    const threads = await this.reviewThreadRepository.find({
      where: {
        reviewId,
        messageId: In(messageIds),
        selection: Not(IsNull()),
      },
    });

    const isCommentVisible = review.createdBy === userId;
    const limit = 5;
    const threadIds = threads.map((thread) => thread.id);

    const comments = await this.reviewCommentRepository
      .getCommentsForThreadIds(threadIds, isCommentVisible)
      .then((results) => results.filter((result) => result.row_num <= limit));

    if (comments.length === 0) {
      return {
        data: transcript.messages.map((message) => ({
          ...message,
          threads: [],
        })),
        count: transcript.count,
      };
    }

    const commentIds = comments.map((comment) => comment.comment_id);

    const userIds = [
      ...new Set([
        ...threads.map((thread) => thread.createdBy),
        ...comments.map((comment) => comment.comment_createdBy),
      ]),
    ];

    const [reactions, users, myReactions] = await Promise.all([
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
    ]);

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

    const commentsByThread = comments.reduce(
      (acc, comment) => {
        if (!acc[comment.comment_reviewThreadId]) {
          acc[comment.comment_reviewThreadId] = [];
        }

        const user = userMap.get(comment.comment_createdBy);
        acc[comment.comment_reviewThreadId].push({
          id: comment.comment_id,
          content: comment.comment_content,
          createdAt: comment.comment_createdAt,
          createdBy: user,
          reactions: reactionsByComment[comment.comment_id] || {},
          myReaction: myReactionsByCommentId[comment.comment_id] || null,
          hidden: comment.comment_hidden,
          replyCount: parseInt(comment.reply_count, 10) || 0,
        });
        return acc;
      },
      {} as Record<string, any[]>,
    );

    // Group threads by message
    const threadsByMessage = threads.reduce(
      (acc, thread) => {
        if (!thread.messageId) return acc;
        const threadComments = commentsByThread[thread.id] || [];
        if (threadComments.length === 0) return acc;

        if (!acc[thread.messageId]) {
          acc[thread.messageId] = [];
        }

        const user = userMap.get(thread.createdBy);
        acc[thread.messageId].push({
          id: thread.id,
          comments: threadComments,
          selection: thread.selection,
          createdBy: user,
        });
        return acc;
      },
      {} as Record<number, any[]>,
    );

    const data = transcript.messages.map((message) => ({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      startSeconds: message.startSeconds,
      endSeconds: message.endSeconds,
      senderId: message.senderId,
      threads: threadsByMessage[message.id] || [],
    }));

    return {
      data,
      count: transcript.count,
    };
  }
}
