import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewThreadRepository } from 'src/review/repository/base-review-thread.repository';
import { ScenarioSessionReviewThread } from '../entity/thread.entity';
import { ScenarioSessionReviewComment } from '../entity/comment.entity';
import { ScenarioSessionReview } from '../entity/review.entity';

@Injectable()
export class ScenarioSessionReviewThreadRepository extends BaseReviewThreadRepository<
  ScenarioSessionReviewThread,
  ScenarioSessionReviewComment,
  ScenarioSessionReview
> {
  protected commentEntity = ScenarioSessionReviewComment;
  protected reviewEntity = ScenarioSessionReview;

  constructor(dataSource: DataSource) {
    super(ScenarioSessionReviewThread, dataSource);
  }

  protected getCommentTableName(): string {
    return 'scenario_session_review_comments';
  }
}
