import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewReaction } from '../entity/review-reaction.entity';
import { Review } from '../entity/review.entity';
import { ReviewReactionOptions } from '../type/review.type';

@Injectable()
export class ReviewReactionRepository extends Repository<ReviewReaction> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewReaction, dataSource.createEntityManager());
  }

  async getReactionsByReviewIds(reviewIds: string[]) {
    return this.createQueryBuilder('rr')
      .select([
        'rr.reviewId AS "reviewId"',
        'rr.reaction AS "reaction"',
        'COUNT(rr.id) AS "count"',
      ])
      .where('rr.reviewId IN (:...reviewIds)', { reviewIds })
      .groupBy('rr.reviewId, rr.reaction')
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
      .innerJoin(Review, 'r', 'r.id = rr.reviewId')
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
      .innerJoin(Review, 'r', 'r.id = rr.reviewId')
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
  async getReviewReactions(reviewId: string, options: ReviewReactionOptions) {
    const { reaction, limit = 20, offset = 0 } = options;
    const query = this.createQueryBuilder('rr').where(
      'rr.reviewId = :reviewId',
      { reviewId },
    );

    if (reaction) {
      query.andWhere('rr.reaction = :reaction', { reaction });
    }

    return query
      .orderBy('rr.createdAt', 'DESC')
      .limit(limit)
      .offset(offset)
      .getManyAndCount();
  }
}
