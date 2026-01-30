import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { Review } from '../entity/review.entity';
import {
  GetReviewsOptions,
  Reviews,
  ReviewSortBy,
  ReviewsResult,
  ReviewStatus,
} from '../type/review.type';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';
import { ReviewComment } from '../entity/review-comment.entity';

@Injectable()
export class ReviewRepository extends Repository<Review> {
  constructor(private readonly dataSource: DataSource) {
    super(Review, dataSource.createEntityManager());
  }

  async getAllReviews(
    options: GetReviewsOptions,
    tenantId: string,
    userId: number,
  ): Promise<ReviewsResult> {
    const query = this.createQueryBuilder('review')
      .leftJoinAndMapOne(
        'review.scenarioSession',
        ScenarioSessions,
        'scenarioSession',
        'scenarioSession.id = review.scenarioSessionId',
      )
      .withDeleted()
      .leftJoinAndMapOne(
        'review.scenario',
        Scenarios,
        'scenario',
        'scenario.id = scenarioSession.scenarioId',
      )
      .leftJoinAndMapOne(
        'review.createdBy',
        User,
        'user',
        'user.id = review.createdBy',
      )
      .where('review.tenantId = :tenantId', { tenantId })
      .andWhere('review.status = :status', { status: ReviewStatus.IN_REVIEW });

    if (options.sortBy === ReviewSortBy.MOST_REVIEWED) {
      query
        .leftJoin(
          'review_threads',
          'reviewThread',
          'reviewThread.reviewId = review.id',
        )
        .leftJoin(
          ReviewComment,
          'reviewComment',
          'reviewComment.reviewThreadId = reviewThread.id AND (reviewComment.hidden = false OR review.createdBy = :userId)',
          { userId },
        )
        .addSelect('COUNT(reviewComment.id)', 'comments_count')
        .groupBy('review.id, scenarioSession.id, scenario.id, user.id')
        .orderBy('comments_count', 'DESC');
    } else if (options.sortBy === ReviewSortBy.UNDISCOVERED) {
      query
        .leftJoin(
          'review_threads',
          'reviewThread',
          'reviewThread.reviewId = review.id',
        )
        .leftJoin(
          ReviewComment,
          'reviewComment',
          'reviewComment.reviewThreadId = reviewThread.id AND (reviewComment.hidden = false OR review.createdBy = :userId)',
          { userId },
        )
        .addSelect('COUNT(reviewComment.id)', 'comments_count')
        .groupBy('review.id, scenarioSession.id, scenario.id, user.id')
        .orderBy('comments_count', 'ASC');
    } else {
      const sortBy =
        options.sortBy === ReviewSortBy.LATEST ? 'updatedAt' : 'createdAt';
      query.orderBy(`review.${sortBy}`, options.sortOrder);
    }
    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }

    const [reviews, count] = await query.getManyAndCount();

    return { reviews: reviews as unknown as Reviews[], count };
  }
}
