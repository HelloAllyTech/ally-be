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
      .select('COUNT(review.id)', 'count')
      .from(Review, 'review')
      .leftJoin(
        ReviewReadStatus,
        'rrs',
        'rrs.reviewId = review.id AND rrs.userId = :userId',
        { userId },
      )
      .where('review.tenantId = :tenantId', { tenantId })
      .andWhere('review.status = :status', { status: ReviewStatus.IN_REVIEW })
      .andWhere('rrs.id IS NULL')
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
