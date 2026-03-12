import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { ScribeSessionReview } from '../entity/review.entity';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import {
  GetReviewsOptions,
  ReviewSortBy,
  ReviewStatus,
} from 'src/review/type/review.type';
import { Chat } from 'src/chat/entity/chat.entity';
import { User } from 'src/user/entity/user.entity';
import {
  ScribeSessionReviews,
  ScribeSessionReviewsResult,
} from '../type/scribe-session-reviews.type';
import { CallDetails } from 'src/chat/entity/call.details.entity';

@Injectable()
export class ScribeSessionReviewRepository extends Repository<ScribeSessionReview> {
  constructor(private readonly dataSource: DataSource) {
    super(ScribeSessionReview, dataSource.createEntityManager());
  }

  async getAllReviews(
    options: GetReviewsOptions,
    tenantId: string,
    userId: number,
  ): Promise<ScribeSessionReviewsResult> {
    const query = this.createQueryBuilder('review')
      .leftJoinAndMapOne(
        'review.chat',
        Chat,
        'chat',
        'chat.id = review.scribeSessionId',
      )
      .leftJoinAndMapOne(
        'review.callDetails',
        CallDetails,
        'callDetails',
        'callDetails.chatId = chat.id',
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
          'scribe_session_review_threads',
          'reviewThread',
          'reviewThread.reviewId = review.id',
        )
        .leftJoin(
          ScribeSessionReviewComment,
          'reviewComment',
          'reviewComment.reviewThreadId = reviewThread.id AND (reviewComment.hidden = false OR review.createdBy = :userId)',
          { userId },
        )
        .addSelect('COUNT(reviewComment.id)', 'comments_count')
        .groupBy('review.id, chat.id, user.id, callDetails.id')
        .orderBy('comments_count', 'DESC');
    } else if (options.sortBy === ReviewSortBy.UNDISCOVERED) {
      query
        .leftJoin(
          'scribe_session_review_threads',
          'reviewThread',
          'reviewThread.reviewId = review.id',
        )
        .leftJoin(
          ScribeSessionReviewComment,
          'reviewComment',
          'reviewComment.reviewThreadId = reviewThread.id AND (reviewComment.hidden = false OR review.createdBy = :userId)',
          { userId },
        )
        .addSelect('COUNT(reviewComment.id)', 'comments_count')
        .groupBy('review.id, chat.id, user.id, callDetails.id')
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

    return { reviews: reviews as unknown as ScribeSessionReviews[], count };
  }
}
