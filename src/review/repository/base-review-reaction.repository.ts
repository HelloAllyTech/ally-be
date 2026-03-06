import { DataSource, EntityTarget, Repository } from 'typeorm';
import { BaseReviewReaction } from '../entity/base-review-reaction.entity';
import { BaseReview } from '../entity/base-review.entity';
import {
  ReactionCount,
  ReviewReactionCount,
  ReviewReactionOptions,
} from '../type/review-reaction.type';

export abstract class BaseReviewReactionRepository<
  TReaction extends BaseReviewReaction,
  TReview extends BaseReview,
> extends Repository<TReaction> {
  protected abstract reviewEntity: EntityTarget<TReview>;

  constructor(entity: EntityTarget<TReaction>, dataSource: DataSource) {
    super(entity, dataSource.createEntityManager());
  }

  async getReactionsByReviewIds(
    reviewIds: string[],
  ): Promise<ReviewReactionCount[]> {
    if (!reviewIds.length) return [];
    return this.createQueryBuilder('reviewReaction')
      .select([
        'reviewReaction.reviewId AS "reviewId"',
        'reviewReaction.reaction AS "reaction"',
        'COUNT(reviewReaction.id) AS "count"',
      ])
      .where('reviewReaction.reviewId IN (:...reviewIds)', { reviewIds })
      .groupBy('reviewReaction.reviewId, reviewReaction.reaction')
      .getRawMany();
  }

  async getGivenReviewReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rr')
      .innerJoin(this.reviewEntity as any, 'r', 'r.id = rr.reviewId')
      .where('r.createdBy != rr.createdBy')
      .select('rr.createdBy', 'userId')
      .addSelect('COUNT(rr.id)', 'count')
      .groupBy('rr.createdBy');

    if (userIds) {
      query.andWhere('rr.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('rr.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }

  async getReceivedReviewReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const query = this.createQueryBuilder('rr')
      .innerJoin(this.reviewEntity as any, 'r', 'r.id = rr.reviewId')
      .where('r.createdBy != rr.createdBy')
      .select('r.createdBy', 'userId')
      .addSelect('COUNT(rr.id)', 'count')
      .groupBy('r.createdBy');

    if (userIds) {
      query.andWhere('r.createdBy IN (:...userIds)', { userIds });
    }
    if (tenantIds) {
      query.andWhere('r.tenantId IN (:...tenantIds)', { tenantIds });
    }

    return query.getRawMany();
  }

  async getReviewReactions(
    reviewId: string,
    options: ReviewReactionOptions,
  ): Promise<[TReaction[], number]> {
    const { reaction, limit = 20, offset = 0 } = options;
    const query = this.createQueryBuilder('reviewReaction').where(
      'reviewReaction.reviewId = :reviewId',
      { reviewId },
    );

    if (reaction) {
      query.andWhere('reviewReaction.reaction = :reaction', { reaction });
    }

    return query
      .orderBy('reviewReaction.createdAt', 'DESC')
      .limit(limit)
      .offset(offset)
      .getManyAndCount();
  }

  async getReviewReactionsAndCount(reviewId: string): Promise<ReactionCount[]> {
    return this.createQueryBuilder('reviewReaction')
      .select(['reviewReaction.reaction AS reaction', 'COUNT(*) AS count'])
      .where('reviewReaction.reviewId = :reviewId', { reviewId })
      .groupBy('reviewReaction.reaction')
      .getRawMany();
  }
}
