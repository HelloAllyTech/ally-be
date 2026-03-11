import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/service/user.service';
import { BaseReviewThreadService } from 'src/review/service/base-review-thread.service';
import { ScribeReviewAccessValidator } from '../util/scribe-review-access-validator';
import { ScribeSessionReview } from '../entity/review.entity';
import { ScribeSessionReviewThread } from '../entity/thread.entity';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import { ScribeSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewThreadRepository } from '../repository/thread.repository';
import { ScribeSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScribeSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';

@Injectable()
export class ScribeSessionReviewThreadService extends BaseReviewThreadService<
  ScribeSessionReview,
  ScribeSessionReviewThread,
  ScribeSessionReviewComment,
  ScribeSessionReviewCommentReaction
> {
  constructor(
    protected readonly reviewRepository: ScribeSessionReviewRepository,
    protected readonly reviewThreadRepository: ScribeSessionReviewThreadRepository,
    protected readonly reviewCommentRepository: ScribeSessionReviewCommentRepository,
    protected readonly reviewCommentReactionRepository: ScribeSessionReviewCommentReactionRepository,
    protected readonly userService: UserService,
    protected readonly reviewAccessValidator: ScribeReviewAccessValidator,
  ) {
    super();
  }

  protected async getMessagesByIds(): Promise<any[]> {
    // TODO: Implement scribe-specific message fetching
    return [];
  }
}
