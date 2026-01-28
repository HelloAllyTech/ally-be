import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewThread } from '../entity/review-thread.entity';
import { Pagination } from 'src/common/type/common.type';
import { ReviewComment } from '../entity/review-comment.entity';
import { ReviewCommentCount } from '../type/review-thread.type';
import { Review } from '../entity/review.entity';

@Injectable()
export class ReviewThreadRepository extends Repository<ReviewThread> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewThread, dataSource.createEntityManager());
  }

  async getReviewThreadsByReviewId(
    reviewId: string,
    isHidden: boolean,
    options?: Pagination,
  ): Promise<{ threads: ReviewThread[]; count: number }> {
    const query = this.createQueryBuilder('reviewThread').where(
      'reviewThread.reviewId = :reviewId',
      { reviewId },
    );
    if (!isHidden) {
      query.andWhere(
        `EXISTS (
          SELECT 1 
          FROM review_comments rc 
          WHERE rc."reviewThreadId" = "reviewThread".id 
          AND rc."parentCommentId" IS NULL 
          AND rc."deletedAt" IS NULL
          AND rc.hidden = false
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
    return this.createQueryBuilder('rt')
      .select(['rt.reviewId AS "reviewId"', 'COUNT(rc.id) AS "count"'])
      .innerJoin(Review, 'review', 'review.id = rt.reviewId')
      .innerJoin(
        ReviewComment,
        'rc',
        `rc.reviewThreadId = rt.id AND (
        rc.hidden = false OR 
        review.createdBy = :userId
      )`,
        { userId },
      )
      .where('rt.reviewId IN (:...reviewIds)', { reviewIds })
      .groupBy('rt.reviewId')
      .getRawMany();
  }
}
