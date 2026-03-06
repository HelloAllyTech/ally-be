import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewReactionRepository } from 'src/review/repository/base-review-reaction.repository';
import { ScribeSessionReviewReaction } from '../entity/reaction.entity';
import { ScribeSessionReview } from '../entity/review.entity';

@Injectable()
export class ScribeSessionReviewReactionRepository extends BaseReviewReactionRepository<
  ScribeSessionReviewReaction,
  ScribeSessionReview
> {
  protected reviewEntity = ScribeSessionReview;

  constructor(dataSource: DataSource) {
    super(ScribeSessionReviewReaction, dataSource);
  }
}
