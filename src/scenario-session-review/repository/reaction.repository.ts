import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewReactionRepository } from 'src/review/repository/base-review-reaction.repository';
import { ScenarioSessionReviewReaction } from '../entity/reaction.entity';
import { ScenarioSessionReview } from '../entity/review.entity';

@Injectable()
export class ScenarioSessionReviewReactionRepository extends BaseReviewReactionRepository<
  ScenarioSessionReviewReaction,
  ScenarioSessionReview
> {
  protected reviewEntity = ScenarioSessionReview;

  constructor(dataSource: DataSource) {
    super(ScenarioSessionReviewReaction, dataSource);
  }
}
