import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewReadStatusRepository } from 'src/review/repository/base-review-read-status.repository';
import { ScenarioSessionReviewReadStatus } from '../entity/read-status.entity';
import { ScenarioSessionReview } from '../entity/review.entity';

@Injectable()
export class ScenarioSessionReviewReadStatusRepository extends BaseReviewReadStatusRepository<
  ScenarioSessionReviewReadStatus,
  ScenarioSessionReview
> {
  protected reviewEntity = ScenarioSessionReview;

  constructor(dataSource: DataSource) {
    super(ScenarioSessionReviewReadStatus, dataSource);
  }
}
