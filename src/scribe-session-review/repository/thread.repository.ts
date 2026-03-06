import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewThreadRepository } from 'src/review/repository/base-review-thread.repository';
import { ScribeSessionReviewThread } from '../entity/thread.entity';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import { ScribeSessionReview } from '../entity/review.entity';

@Injectable()
export class ScribeSessionReviewThreadRepository extends BaseReviewThreadRepository<
  ScribeSessionReviewThread,
  ScribeSessionReviewComment,
  ScribeSessionReview
> {
  protected commentEntity = ScribeSessionReviewComment;
  protected reviewEntity = ScribeSessionReview;

  constructor(dataSource: DataSource) {
    super(ScribeSessionReviewThread, dataSource);
  }

  protected getCommentTableName(): string {
    return 'scribe_session_review_comments';
  }
}
