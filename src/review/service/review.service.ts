import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
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
import { UserService } from 'src/user/service/user.service';

@Injectable()
export class ReviewService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
    private readonly userService: UserService,
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

  async getReviewThreads(reviewId: string): Promise<ReviewThreadsResponseDto> {
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

    const reviewThreads = await this.reviewThreadRepository.find({
      where: { reviewId },
    });

    const reviewComments = await this.reviewCommentRepository.find({
      where: { reviewThreadId: In(reviewThreads.map((thread) => thread.id)) },
    });

    const usersPromise = this.userService.getUsersByIds(
      reviewComments.map((comment) => comment.createdBy),
    );
    const reviewCommentReactionsPromise =
      this.reviewCommentReactionRepository.find({
        where: {
          reviewCommentId: In(reviewComments.map((comment) => comment.id)),
        },
      });

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
      count: reviewThreadsData.length,
    };
  }
}
