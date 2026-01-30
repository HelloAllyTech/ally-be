import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewReaction } from '../entity/review-reaction.entity';
import { Review } from '../entity/review.entity';
import { ReviewReactionOptions } from '../type/review-reaction.type';
import {
  ReactionCount,
  ReviewReactionCount,
} from '../type/review-reaction.type';

@Injectable()
export class ReviewReactionRepository extends Repository<ReviewReaction> {
  constructor(private readonly dataSource: DataSource) {
    super(ReviewReaction, dataSource.createEntityManager());
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
  async getReviewReactions(
    reviewId: string,
    options: ReviewReactionOptions,
  ): Promise<[ReviewReaction[], number]> {
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
