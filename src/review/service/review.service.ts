import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ReviewRepository } from '../repository/review.repository';
import {
  CreateReviewDto,
  CreateReviewResponseDto,
} from '../dto/create-review.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ReviewThreadsResponseDto } from '../dto/review-threads.dto';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';
import { User } from 'src/user/entity/user.entity';
import { Pagination } from 'src/common/type/common.type';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { UpdateReviewStatusDto } from '../dto/update-review-status.dto';
import { GetReviews, GetReviewsOptions, Reviews } from '../type/review.type';
import { UserService } from 'src/user/service/user.service';
import { ReviewReactionRepository } from '../repository/review-reaction.repository';
import { GetReviewResponseDto } from '../dto/get-review-response.dto';
import {
  CreateCommentResponseDto,
  CreateReviewCommentDto,
} from '../dto/create-comment.dto';
import { ReviewThread } from '../entity/review-thread.entity';
import { ReviewComment } from '../entity/review-comment.entity';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class ReviewService {
  private readonly logger = LoggerService.getInstance(ReviewService.name);
  constructor(
    private readonly dataSource: DataSource,
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewReactionRepository: ReviewReactionRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly userService: UserService,
    private readonly permissionValidator: PermissionValidator,
  ) {}

  async createReview(
    createReviewDto: CreateReviewDto,
  ): Promise<CreateReviewResponseDto> {
    const userId = ExecutionManager.getUserId();
    const tenantId = ExecutionManager.getTenantId();
    if (!userId) {
      throw new BadRequestException('User or tenant not found');
    }
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }
    const scenarioSession =
      await this.scenarioSharedService.getScenarioSessionById(
        createReviewDto.scenarioSessionId,
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
      createdBy: Number(userId),
      tenantId: tenantId,
    });
    const savedReview = await this.reviewRepository.save(review);

    return { id: savedReview.id };
  }

  async getReviewThreads(
    reviewId: string,
    options?: Pagination,
  ): Promise<ReviewThreadsResponseDto> {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
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
      (isReviewer && review.tenantId !== ExecutionManager.getTenantId()) ||
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
  async findReviewById(id: string): Promise<any> {
    return this.reviewRepository.findOne({ where: { id } });
  }

  async updateReviewStatus(
    id: string,
    updateReviewStatusDto: UpdateReviewStatusDto,
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

    const updatedReview = await this.reviewRepository.create({
      ...review,
      status: updateReviewStatusDto.status,
    });
    await this.reviewRepository.save(updatedReview);
    return { success: true };
  }

  async getAllReviews(options: GetReviewsOptions): Promise<any> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }
    const result = await this.reviewRepository.getAllReviews(options, tenantId);

    if (result.reviews.length === 0) return { data: [], count: result.count };

    const reviewIds = result.reviews.map((r: Reviews) => r.id);

    const [reactions, comments] = await Promise.all([
      this.reviewReactionRepository.getReactionsByReviewIds(reviewIds),
      this.reviewThreadRepository.getCommentsCountByReviewIds(reviewIds),
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

    const review = await this.findReviewById(id);
    if (!review) {
      throw new BadRequestException('Review not found');
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

    const scenarioSession =
      await this.scenarioSharedService.getScenarioSessionById(
        review.scenarioSessionId,
      );

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    const [user, scenario, comments] = await Promise.all([
      this.userService.get(review.createdBy),
      this.scenarioSharedService.getScenarioById(scenarioSession.scenarioId),
      this.reviewThreadRepository.getCommentsCountByReviewIds([review.id]),
    ]);
    return {
      id: review.id,
      scenario: {
        title: scenario?.title,
        createdAt: scenario?.createdAt,
        duration: this.getSessionDurationInSeconds(
          scenarioSession.startedAt!,
          scenarioSession.endedAt!,
        ),
        description: scenario?.description,
        coverImageUrl: scenario?.coverImageUrl,
        coverVideoUrl: scenario?.coverVideoUrl,
      },
      commentsCount: comments.length > 0 ? Number(comments[0].count) : 0,
      createdBy: {
        id: user?.id,
        name: user?.name,
        profileImage: user?.profileImageUrl ?? null,
      },
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
      scenario: {
        title: review.scenario.title,
        createdAt: review.scenario.createdAt,
        duration: this.getSessionDurationInSeconds(
          review.scenarioSession.startedAt!,
          review.scenarioSession.endedAt!,
        ),
        description: review.scenario.description,
        coverImageUrl: review.scenario.coverImageUrl,
        coverVideoUrl: review.scenario.coverVideoUrl,
      },
      commentsCount: commentsByReviewId[review.id] ?? 0,
      reactions: reactionsByReviewId[review.id] ?? {},
      createdBy: {
        id: review.createdBy.id,
        name: review.createdBy.name,
        profileImage: review.createdBy.profileImageUrl ?? null,
      },
    }));

    return data;
  }

  private getSessionDurationInSeconds(startDate: Date, endDate: Date) {
    return startDate && endDate
      ? Math.max(
          0,
          Math.floor(
            (new Date(endDate).getTime() - new Date(startDate).getTime()) /
              1000,
          ),
        )
      : 0;
  }

  async addCommentToReview(
    reviewId: string,
    createReviewCommentDto: CreateReviewCommentDto,
  ): Promise<CreateCommentResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const review = await this.findReviewById(reviewId);
    if (!review) {
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
      throw new BadRequestException('Content cannot be empty');
    }

    if (createReviewCommentDto.threadId) {
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
      });
      await this.reviewCommentRepository.save(comment);

      return {
        commentId: comment.id,
      };
    }

    if (createReviewCommentDto.parentCommentId) {
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
      });
      await this.reviewCommentRepository.save(reply);
      return {
        replyId: reply.id,
      };
    }

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
      try {
        const result = await this.dataSource.transaction(
          async (entityManager) => {
            const thread = entityManager.create(ReviewThread, {
              reviewId,
              messageId: createReviewCommentDto.messageId,
              createdBy: Number(userId),
              selection: createReviewCommentDto.selection,
            });
            await entityManager.save(ReviewThread, thread);
            const comment = entityManager.create(ReviewComment, {
              reviewThreadId: thread.id,
              content: createReviewCommentDto.content,
              createdBy: Number(userId),
            });
            await entityManager.save(ReviewComment, comment);
            return {
              threadId: thread.id,
              commentId: comment.id,
            };
          },
        );

        return result;
      } catch (error) {
        this.logger.error(
          `Failed to add comment: ${error.message}`,
          error.stack,
        );
        throw new BadRequestException(
          `Failed to add comment: ${error.message}`,
        );
      }
    }
    throw new BadRequestException('Invalid request');
  }
}
