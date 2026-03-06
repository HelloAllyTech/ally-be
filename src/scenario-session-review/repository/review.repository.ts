import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { ScenarioSessionReview } from '../entity/review.entity';
import { ScenarioSessionReviewComment } from '../entity/comment.entity';
import {
  GetReviewsOptions,
  ReviewSortBy,
  ReviewStatus,
} from 'src/review/type/review.type';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';

export interface ScenarioSessionReviews {
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: string;
  scenarioSessionId: string;
  createdBy: User;
  status: string;
  scenarioSession: ScenarioSessions;
  scenario: Scenarios;
  note?: string | null;
  noteEditedAt?: Date | null;
}

export interface ScenarioSessionReviewsResult {
  reviews: ScenarioSessionReviews[];
  count: number;
}

export interface GetScenarioSessionReviews {
  reviews: ScenarioSessionReviews[];
  count: number;
  reactions: Array<{ reviewId: string; reaction: string; count: string }>;
  comments: Array<{ reviewId: string; count: number }>;
}

@Injectable()
export class ScenarioSessionReviewRepository extends Repository<ScenarioSessionReview> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioSessionReview, dataSource.createEntityManager());
  }

  async getAllReviews(
    options: GetReviewsOptions,
    tenantId: string,
    userId: number,
  ): Promise<ScenarioSessionReviewsResult> {
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
          'scenario_session_review_threads',
          'reviewThread',
          'reviewThread.reviewId = review.id',
        )
        .leftJoin(
          ScenarioSessionReviewComment,
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
          'scenario_session_review_threads',
          'reviewThread',
          'reviewThread.reviewId = review.id',
        )
        .leftJoin(
          ScenarioSessionReviewComment,
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

    return { reviews: reviews as unknown as ScenarioSessionReviews[], count };
  }
}
