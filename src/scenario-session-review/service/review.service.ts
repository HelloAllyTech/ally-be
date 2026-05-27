import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { BaseReviewService } from 'src/review/service/base-review.service';
import { ScenarioSessionReviewReadStatusRepository } from '../repository/read-status.repository';
import { ScenarioSessionReviewReadStatus } from '../entity/read-status.entity';
import { ScenarioSessionReview } from '../entity/review.entity';
import {
  ScenarioSessionReviewRepository,
  ScenarioSessionReviews,
  GetScenarioSessionReviews,
} from '../repository/review.repository';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ScenarioSessionReviewThreadRepository } from '../repository/thread.repository';
import { Pagination } from 'src/common/type/common.type';
import { GetReviewsOptions, ReviewStatus } from 'src/review/type/review.type';
import { UserService } from 'src/user/service/user.service';
import { ScenarioSessionReviewReactionRepository } from '../repository/reaction.repository';
import { LoggerService } from 'src/logger/logger.service';
import {
  formatCreatedUserDetails,
  getSessionDurationInSeconds,
} from 'src/review/util/review.util';
import { In, IsNull, Not } from 'typeorm';
import { ScenarioSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScenarioSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';
import { GetReviewMessagesResponseDto } from 'src/review/dto/review-messages-response.dto';
import { ScenarioReviewAccessValidator } from '../util/scenario-review-access-validator';
import {
  CreateScenarioSessionReviewDto,
  CreateScenarioSessionReviewResponseDto,
} from '../dto/create-review.dto';
import { GetScenarioSessionReviewResponseDto } from '../dto/get-review-response.dto';
import { ScenarioSessionRecordingService } from 'src/learn/service/scenario-session-recording.service';

@Injectable()
export class ScenarioSessionReviewService extends BaseReviewService<
  ScenarioSessionReview,
  ScenarioSessionReviewReadStatus
> {
  private readonly logger = LoggerService.getInstance(
    ScenarioSessionReviewService.name,
  );
  constructor(
    protected readonly reviewRepository: ScenarioSessionReviewRepository,
    private readonly reviewThreadRepository: ScenarioSessionReviewThreadRepository,
    private readonly reviewReactionRepository: ScenarioSessionReviewReactionRepository,
    private readonly reviewCommentRepository: ScenarioSessionReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ScenarioSessionReviewCommentReactionRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly userService: UserService,
    protected readonly reviewAccessValidator: ScenarioReviewAccessValidator,
    protected readonly reviewReadStatusRepository: ScenarioSessionReviewReadStatusRepository,
    protected readonly permissionValidator: PermissionValidator,
    private readonly scenarioSessionRecordingService: ScenarioSessionRecordingService,
  ) {
    super();
  }

  async createReview(
    createReviewDto: CreateScenarioSessionReviewDto,
  ): Promise<CreateScenarioSessionReviewResponseDto> {
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

    const reviewIds = result.reviews.map(
      (review: ScenarioSessionReviews) => review.id,
    );

    const scenarioSessionIds = result.reviews
      .map((review: ScenarioSessionReviews) => review.scenarioSessionId)
      .filter((id): id is string => !!id);

    const [reactions, comments, audioUrlsBySessionId] = await Promise.all([
      this.reviewReactionRepository.getReactionsByReviewIds(reviewIds),
      this.reviewThreadRepository.getCommentsCountByReviewIds(
        reviewIds,
        userId,
      ),
      this.scenarioSessionRecordingService.getRecordingUrlsForSessions(
        scenarioSessionIds,
      ),
    ]);

    const data = this.formatReviewListResponse(
      {
        reviews: result.reviews,
        count: result.count,
        reactions,
        comments,
      },
      options?.languageCode,
      audioUrlsBySessionId,
    );
    return { data, count: result.count };
  }

  async getReviewById(
    id: string,
    languageCode?: string,
  ): Promise<GetScenarioSessionReviewResponseDto> {
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
      audioUrl,
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
      this.scenarioSessionRecordingService.getRecordingUrlForSession(
        scenarioSession.id,
      ),
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
        title:
          (languageCode && scenario?.translations?.[languageCode]?.title) ||
          scenario?.title,
        createdAt: scenario?.createdAt,
        name: scenario?.metadata?.name,
        description:
          (languageCode &&
            scenario?.translations?.[languageCode]?.description) ||
          scenario?.description,
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
        audioUrl: audioUrl ?? null,
      },
      commentsCount: comments.length > 0 ? Number(comments[0].count) : 0,
      createdBy: formatCreatedUserDetails(user!),
      reactions: updatedReactions,
      myReaction: myReaction?.reaction ?? null,
      ...(userId === review.createdBy && { reviewStatus: review.status }),
      generalCommentsThreadId: generalCommentsThread?.id ?? null,
      note: review.note ?? null,
      noteEditedAt: review.noteEditedAt ?? null,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }

  private formatReviewListResponse(
    result: GetScenarioSessionReviews,
    languageCode?: string,
    audioUrlsBySessionId?: Map<string, string>,
  ) {
    const reactionsByReviewId = result.reactions.reduce(
      (acc, reaction) => {
        const reviewId = reaction.reviewId;
        acc[reviewId] ??= {};
        acc[reviewId][reaction.reaction] = Number(reaction.count);
        return acc;
      },
      {} as Record<string, Record<string, number>>,
    );

    const commentsByReviewId = result.comments.reduce(
      (acc, comment) => {
        acc[comment.reviewId] = Number(comment.count);
        return acc;
      },
      {} as Record<string, number>,
    );

    const data = result.reviews.map((review: ScenarioSessionReviews) => ({
      id: review.id,
      createdAt: review.createdAt,
      scenario: review.scenario
        ? {
            title:
              languageCode &&
              review.scenario.translations &&
              review.scenario.translations[languageCode]
                ? review.scenario.translations[languageCode].title
                : review.scenario.title,
            createdAt: review.scenario.createdAt,
            description:
              languageCode &&
              review.scenario.translations &&
              review.scenario.translations[languageCode]
                ? review.scenario.translations[languageCode].description
                : review.scenario.description,
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
            audioUrl:
              audioUrlsBySessionId?.get(review.scenarioSession.id) ?? null,
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
