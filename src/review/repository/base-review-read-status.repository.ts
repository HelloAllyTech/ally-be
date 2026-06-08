import { DataSource, EntityTarget, In, Repository } from 'typeorm';
import { BaseReviewReadStatus } from '../entity/base-review-read-status.entity';
import { BaseReview } from '../entity/base-review.entity';
import { ReviewStatus } from '../type/review.type';

export abstract class BaseReviewReadStatusRepository<
  TReadStatus extends BaseReviewReadStatus,
  TReview extends BaseReview,
> extends Repository<TReadStatus> {
  protected abstract reviewEntity: EntityTarget<TReview>;

  constructor(
    entity: EntityTarget<TReadStatus>,
    protected readonly dataSource: DataSource,
  ) {
    super(entity, dataSource.createEntityManager());
  }

  async getUnreadCount(userId: number, tenantId: string): Promise<number> {
    const result = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(review.id)', 'count')
      .from(this.reviewEntity as any, 'review')
      .leftJoin(
        this.target as any,
        'rrs',
        'rrs."reviewId" = review.id AND rrs."userId" = :userId',
        { userId },
      )
      .where('review.tenantId = :tenantId', { tenantId })
      .andWhere('review.status = :status', { status: ReviewStatus.IN_REVIEW })
      .andWhere('rrs.id IS NULL')
      .getRawOne();

    return parseInt(result?.count ?? '0', 10);
  }

  async getReadReviewIds(
    userId: number,
    reviewIds: string[],
  ): Promise<Set<string>> {
    if (reviewIds.length === 0) {
      return new Set();
    }
    const readStatuses = await this.find({
      where: { userId, reviewId: In(reviewIds) } as any,
      select: ['reviewId'] as any,
    });
    return new Set(readStatuses.map((status) => status.reviewId));
  }

  async markAsRead(userId: number, reviewId: string): Promise<void> {
    await this.upsert(
      {
        userId,
        reviewId,
        readAt: new Date(),
      } as any,
      ['userId', 'reviewId'],
    );
  }
}
