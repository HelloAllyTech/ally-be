import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewThread } from '../entity/review-thread.entity';
import { ReviewComment } from '../entity/review-comment.entity';
import { ReviewCommentCount } from '../type/review-thread.type';
import { Review } from '../entity/review.entity';
import { Pagination } from 'src/common/type/common.type';

@Injectable()
export class ReviewThreadRepository extends Repository<ReviewThread> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewThread, dataSource.createEntityManager());
  }

  async getReviewThreadsByReviewId(
    reviewId: string,
    isCommentVisible: boolean,
    options?: Pagination,
  ): Promise<{ threads: ReviewThread[]; count: number }> {
    const query = this.createQueryBuilder('reviewThread').where(
      'reviewThread.reviewId = :reviewId',
      { reviewId },
    );
    query.andWhere(
      'reviewThread.messageId IS NOT NULL AND reviewThread.selection IS NOT NULL',
    );

    if (!isCommentVisible) {
      query.andWhere(
        `EXISTS (
          SELECT 1 
          FROM review_comments comment   
          WHERE comment."reviewThreadId" = "reviewThread".id 
          AND comment."parentCommentId" IS NULL 
          AND comment."deletedAt" IS NULL
          AND comment.hidden = false
        )`,
      );
    }

    // Order by creation date
    query.orderBy('reviewThread.createdAt', 'ASC');

    // Apply pagination
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    // Get entities and total count in a single query
    const [threads, count] = await query.getManyAndCount();

    return { threads, count };
  }

  async getCommentsCountByReviewIds(
    reviewIds: string[],
    userId: number,
  ): Promise<ReviewCommentCount[]> {
    if (!reviewIds.length) return [];
    return this.createQueryBuilder('reviewThread')
      .select([
        'reviewThread.reviewId AS "reviewId"',
        'COUNT(reviewComment.id) AS "count"',
      ])
      .innerJoin(Review, 'review', 'review.id = reviewThread.reviewId')
      .innerJoin(
        ReviewComment,
        'reviewComment',
        `reviewComment.reviewThreadId = reviewThread.id AND (
        reviewComment.hidden = false OR 
        review.createdBy = :userId
      )`,
        { userId },
      )
      .where('reviewThread.reviewId IN (:...reviewIds)', { reviewIds })
      .groupBy('reviewThread.reviewId')
      .getRawMany();
  }
}
