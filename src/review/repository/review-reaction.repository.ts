import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ReviewReaction } from '../entity/review-reaction.entity';

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
}
