import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseReviewCommentRepository } from 'src/review/repository/base-review-comment.repository';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import { ScribeSessionReviewThread } from '../entity/thread.entity';
import { ScribeSessionReview } from '../entity/review.entity';

@Injectable()
export class ScribeSessionReviewCommentRepository extends BaseReviewCommentRepository<
  ScribeSessionReviewComment,
  ScribeSessionReviewThread,
  ScribeSessionReview
> {
  protected threadEntity = ScribeSessionReviewThread;
  protected reviewEntity = ScribeSessionReview;

  constructor(dataSource: DataSource) {
    super(ScribeSessionReviewComment, dataSource);
  }
}
