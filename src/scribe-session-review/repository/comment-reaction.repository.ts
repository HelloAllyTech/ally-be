import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewCommentReactionRepository } from 'src/review/repository/base-review-comment-reaction.repository';
import { ScribeSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import { ScribeSessionReviewThread } from '../entity/thread.entity';
import { ScribeSessionReview } from '../entity/review.entity';

@Injectable()
export class ScribeSessionReviewCommentReactionRepository extends BaseReviewCommentReactionRepository<
  ScribeSessionReviewCommentReaction,
  ScribeSessionReviewComment,
  ScribeSessionReviewThread,
  ScribeSessionReview
> {
  protected commentEntity = ScribeSessionReviewComment;
  protected threadEntity = ScribeSessionReviewThread;
  protected reviewEntity = ScribeSessionReview;

  constructor(dataSource: DataSource) {
    super(ScribeSessionReviewCommentReaction, dataSource);
  }
}
