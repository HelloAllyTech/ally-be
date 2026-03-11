import { Injectable } from '@nestjs/common';
import { UserService } from 'src/user/service/user.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { BaseReviewThreadService } from 'src/review/service/base-review-thread.service';
import { ScenarioReviewAccessValidator } from '../util/scenario-review-access-validator';
import { ScenarioSessionReview } from '../entity/review.entity';
import { ScenarioSessionReviewThread } from '../entity/thread.entity';
import { ScenarioSessionReviewComment } from '../entity/comment.entity';
import { ScenarioSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScenarioSessionReviewRepository } from '../repository/review.repository';
import { ScenarioSessionReviewThreadRepository } from '../repository/thread.repository';
import { ScenarioSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScenarioSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';

@Injectable()
export class ScenarioSessionReviewThreadService extends BaseReviewThreadService<
  ScenarioSessionReview,
  ScenarioSessionReviewThread,
  ScenarioSessionReviewComment,
  ScenarioSessionReviewCommentReaction
> {
  constructor(
    protected readonly reviewRepository: ScenarioSessionReviewRepository,
    protected readonly reviewThreadRepository: ScenarioSessionReviewThreadRepository,
    protected readonly reviewCommentRepository: ScenarioSessionReviewCommentRepository,
    protected readonly reviewCommentReactionRepository: ScenarioSessionReviewCommentReactionRepository,
    protected readonly userService: UserService,
    protected readonly reviewAccessValidator: ScenarioReviewAccessValidator,
    private readonly scenarioSharedService: ScenarioSharedService,
  ) {
    super();
  }

  protected async getMessagesByIds(messageIds: number[]): Promise<any[]> {
    return this.scenarioSharedService.getMessagesByIds(messageIds);
  }
}
