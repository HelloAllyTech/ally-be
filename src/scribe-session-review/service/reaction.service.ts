import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { UserService } from 'src/user/service/user.service';
import { BaseReviewReactionService } from 'src/review/service/base-review-reaction.service';
import { ReviewAccessValidator } from 'src/review/util/review-access-policy.util';
import { ScribeSessionReview } from '../entity/review.entity';
import { ScribeSessionReviewReaction } from '../entity/reaction.entity';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewReactionRepository } from '../repository/reaction.repository';

@Injectable()
export class ScribeSessionReviewReactionService extends BaseReviewReactionService<
  ScribeSessionReview,
  ScribeSessionReviewReaction
> {
  protected readonly logger = LoggerService.getInstance(
    ScribeSessionReviewReactionService.name,
  );

  constructor(
    protected readonly reviewRepository: ScribeSessionReviewRepository,
    protected readonly reviewReactionRepository: ScribeSessionReviewReactionRepository,
    protected readonly userService: UserService,
    protected readonly reviewAccessValidator: ReviewAccessValidator,
  ) {
    super();
  }
}
