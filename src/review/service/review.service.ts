import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ReviewRepository } from '../repository/review.repository';
import {
  CreateReviewDto,
  CreateReviewResponseDto,
} from '../dto/create-review.dto';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { ReviewThreadRepository } from '../repository/review-thread.repository';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { SuccessResponse } from 'src/common/type/common.type';
import { UpdateReviewStatusDto } from '../dto/update-review-status.dto';
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
import { getSessionDurationInSeconds } from '../util/review.util';

@Injectable()
export class ReviewService {
  private readonly logger = LoggerService.getInstance(ReviewService.name);
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewReactionRepository: ReviewReactionRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly userService: UserService,
    private readonly permissionValidator: PermissionValidator,
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

    const review = await this.reviewRepository.findOne({ where: { id } });

    if (!review) {
      throw new BadRequestException('Review not found');
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
        duration: getSessionDurationInSeconds(
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
        duration: getSessionDurationInSeconds(
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
}
