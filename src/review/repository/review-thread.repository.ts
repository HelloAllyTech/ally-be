import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewThread } from '../entity/review-thread.entity';
import { Pagination } from 'src/common/type/common.type';

@Injectable()
export class ReviewThreadRepository extends Repository<ReviewThread> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewThread, dataSource.createEntityManager());
  }

  async getReviewThreadsByReviewId(
    reviewId: string,
    options?: Pagination,
  ): Promise<{ threads: ReviewThread[]; count: number }> {
    const query = this.createQueryBuilder('reviewThread').where(
      'reviewThread.reviewId = :reviewId',
      { reviewId },
    );

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
}
