import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewReadStatusRepository } from 'src/review/repository/base-review-read-status.repository';
import { ScribeSessionReviewReadStatus } from '../entity/read-status.entity';
import { ScribeSessionReview } from '../entity/review.entity';

@Injectable()
export class ScribeSessionReviewReadStatusRepository extends BaseReviewReadStatusRepository<
  ScribeSessionReviewReadStatus,
  ScribeSessionReview
> {
  protected reviewEntity = ScribeSessionReview;

  constructor(dataSource: DataSource) {
    super(ScribeSessionReviewReadStatus, dataSource);
  }
}
