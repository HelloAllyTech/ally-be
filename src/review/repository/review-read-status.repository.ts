import { Injectable } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { ReviewReadStatus } from '../entity/review-read-status.entity';
import { Review } from '../entity/review.entity';
import { ReviewStatus } from '../type/review.type';

@Injectable()
export class ReviewReadStatusRepository extends Repository<ReviewReadStatus> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewReadStatus, dataSource.createEntityManager());
  }

  async getUnreadCount(userId: number, tenantId: string): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from(Review, 'review')
      .where('review.tenantId = :tenantId', { tenantId })
      .andWhere('review.status = :status', { status: ReviewStatus.IN_REVIEW })
      .andWhere(
        'review.id NOT IN ' +
          this.dataSource
            .createQueryBuilder()
            .subQuery()
            .select('rrs.reviewId')
            .from(ReviewReadStatus, 'rrs')
            .where('rrs.userId = :userId')
            .getQuery(),
        { userId },
      )
      .getRawOne();

    return parseInt(result?.count ?? '0', 10);
  }

  async markAsRead(userId: number, reviewId: string): Promise<void> {
    await this.upsert(
      {
        userId,
        reviewId,
        readAt: new Date(),
      },
      ['userId', 'reviewId'],
    );
  }
}
