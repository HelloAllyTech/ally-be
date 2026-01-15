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
  ): Promise<ReviewsResult> {
    const query = this.createQueryBuilder('r')
      .leftJoinAndMapOne(
        'r.scenarioSession',
        ScenarioSessions,
        'ss',
        'ss.id = r.scenarioSessionId',
      )
      .leftJoinAndMapOne('r.scenario', Scenarios, 's', 's.id = ss.scenarioId')
      .leftJoinAndMapOne('r.createdBy', User, 'u', 'u.id = r.createdBy')
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.status = :status', { status: ReviewStatus.IN_REVIEW });

    if (options.sortBy === ReviewSortBy.MOST_REVIEWED) {
      query
        .leftJoin('review_threads', 'rt', 'rt.reviewId = r.id')
        .leftJoin(ReviewComment, 'rc', 'rc.reviewThreadId = rt.id')
        .addSelect('COUNT(rc.id)', 'comments_count')
        .groupBy('r.id, ss.id, s.id, u.id')
        .orderBy('comments_count', 'DESC');
    } else if (options.sortBy === ReviewSortBy.UNDISCOVERED) {
      query
        .leftJoin('review_threads', 'rt', 'rt.reviewId = r.id')
        .leftJoin(ReviewComment, 'rc', 'rc.reviewThreadId = rt.id')
        .addSelect('COUNT(rc.id)', 'comments_count')
        .groupBy('r.id, ss.id, s.id, u.id')
        .orderBy('comments_count', 'ASC');
    } else {
      const sortBy =
        options.sortBy === ReviewSortBy.LATEST ? 'updatedAt' : 'createdAt';
      query.orderBy(`r.${sortBy}`, options.sortOrder);
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
