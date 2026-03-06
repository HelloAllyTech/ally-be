import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BaseReviewCommentReactionService } from 'src/review/service/base-review-comment-reaction.service';
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
export class ScribeSessionReviewCommentReactionService extends BaseReviewCommentReactionService<
  ScribeSessionReview,
  ScribeSessionReviewThread,
  ScribeSessionReviewComment,
  ScribeSessionReviewCommentReaction
> {
  protected readonly logger = LoggerService.getInstance(
    ScribeSessionReviewCommentReactionService.name,
  );

  constructor(
    protected readonly reviewRepository: ScribeSessionReviewRepository,
    protected readonly reviewThreadRepository: ScribeSessionReviewThreadRepository,
    protected readonly reviewCommentRepository: ScribeSessionReviewCommentRepository,
    protected readonly reviewCommentReactionRepository: ScribeSessionReviewCommentReactionRepository,
    protected readonly reviewAccessValidator: ReviewAccessValidator,
  ) {
    super();
  }
}
