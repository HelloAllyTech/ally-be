import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { UserService } from 'src/user/service/user.service';
import { BaseReviewCommentService } from 'src/review/service/base-review-comment.service';
import { ReviewAccessValidator } from 'src/review/util/review-access-policy.util';
import { ScribeSessionReview } from '../entity/review.entity';
import { ScribeSessionReviewThread } from '../entity/thread.entity';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import { ScribeSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewThreadRepository } from '../repository/thread.repository';
import { ScribeSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScribeSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';

@Injectable()
export class ScribeSessionReviewCommentService extends BaseReviewCommentService<
  ScribeSessionReview,
  ScribeSessionReviewThread,
  ScribeSessionReviewComment,
  ScribeSessionReviewCommentReaction
> {
  protected readonly logger = LoggerService.getInstance(
    ScribeSessionReviewCommentService.name,
  );

  constructor(
    protected readonly dataSource: DataSource,
    protected readonly reviewRepository: ScribeSessionReviewRepository,
    protected readonly reviewThreadRepository: ScribeSessionReviewThreadRepository,
    protected readonly reviewCommentRepository: ScribeSessionReviewCommentRepository,
    protected readonly reviewCommentReactionRepository: ScribeSessionReviewCommentReactionRepository,
    protected readonly userService: UserService,
    protected readonly reviewAccessValidator: ReviewAccessValidator,
  ) {
    super();
  }

  protected getThreadEntityClass() {
    return ScribeSessionReviewThread;
  }

  protected getCommentEntityClass() {
    return ScribeSessionReviewComment;
  }

  protected getCommentReactionEntityClass() {
    return ScribeSessionReviewCommentReaction;
  }
}
