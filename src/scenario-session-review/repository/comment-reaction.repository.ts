import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewCommentReactionRepository } from 'src/review/repository/base-review-comment-reaction.repository';
import { ScenarioSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScenarioSessionReviewComment } from '../entity/comment.entity';
import { ScenarioSessionReviewThread } from '../entity/thread.entity';
import { ScenarioSessionReview } from '../entity/review.entity';

@Injectable()
export class ScenarioSessionReviewCommentReactionRepository extends BaseReviewCommentReactionRepository<
  ScenarioSessionReviewCommentReaction,
  ScenarioSessionReviewComment,
  ScenarioSessionReviewThread,
  ScenarioSessionReview
> {
  protected commentEntity = ScenarioSessionReviewComment;
  protected threadEntity = ScenarioSessionReviewThread;
  protected reviewEntity = ScenarioSessionReview;

  constructor(dataSource: DataSource) {
    super(ScenarioSessionReviewCommentReaction, dataSource);
  }
}
