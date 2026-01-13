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

    // Get total count before applying pagination
    const count = await query.getCount();

    // Apply pagination
    if (options?.limit) {
      query.limit(options.limit);
    }
    if (options?.offset) {
      query.offset(options.offset);
    }

    const threads = await query.getMany();

    return { threads, count };
  }
}
