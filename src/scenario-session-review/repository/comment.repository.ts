import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewCommentRepository } from 'src/review/repository/base-review-comment.repository';
import { ScenarioSessionReviewComment } from '../entity/comment.entity';
import { ScenarioSessionReviewThread } from '../entity/thread.entity';
import { ScenarioSessionReview } from '../entity/review.entity';

@Injectable()
export class ScenarioSessionReviewCommentRepository extends BaseReviewCommentRepository<
  ScenarioSessionReviewComment,
  ScenarioSessionReviewThread,
  ScenarioSessionReview
> {
  protected threadEntity = ScenarioSessionReviewThread;
  protected reviewEntity = ScenarioSessionReview;

  constructor(dataSource: DataSource) {
    super(ScenarioSessionReviewComment, dataSource);
  }
}
