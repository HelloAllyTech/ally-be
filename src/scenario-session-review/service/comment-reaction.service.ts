import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from 'src/logger/logger.service';
import { BaseReviewCommentReactionService } from 'src/review/service/base-review-comment-reaction.service';
import { ScenarioReviewAccessValidator } from '../util/scenario-review-access-validator';
import {
  ScenarioSessionReviewEvents,
  ReviewCommentReactionAddedEventParams,
  ReviewCommentReactionRemovedEventParams,
} from 'src/review/type/review-event.type';
import { ScenarioSessionReview } from '../entity/review.entity';
import { ScenarioSessionReviewThread } from '../entity/thread.entity';
import { ScenarioSessionReviewComment } from '../entity/comment.entity';
import { ScenarioSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScenarioSessionReviewRepository } from '../repository/review.repository';
import { ScenarioSessionReviewThreadRepository } from '../repository/thread.repository';
import { ScenarioSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScenarioSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';

@Injectable()
export class ScenarioSessionReviewCommentReactionService extends BaseReviewCommentReactionService<
  ScenarioSessionReview,
  ScenarioSessionReviewThread,
  ScenarioSessionReviewComment,
  ScenarioSessionReviewCommentReaction
> {
  protected readonly logger = LoggerService.getInstance(
    ScenarioSessionReviewCommentReactionService.name,
  );

  constructor(
    protected readonly reviewRepository: ScenarioSessionReviewRepository,
    protected readonly reviewThreadRepository: ScenarioSessionReviewThreadRepository,
    protected readonly reviewCommentRepository: ScenarioSessionReviewCommentRepository,
    protected readonly reviewCommentReactionRepository: ScenarioSessionReviewCommentReactionRepository,
    private readonly eventEmitter: EventEmitter2,
    protected readonly reviewAccessValidator: ScenarioReviewAccessValidator,
  ) {
    super();
  }

  protected onCommentReactionAdded(
    review: ScenarioSessionReview,
    comment: ScenarioSessionReviewComment,
    reaction: ScenarioSessionReviewCommentReaction,
  ): void {
    this.eventEmitter.emit(ScenarioSessionReviewEvents.COMMENT_REACTION_ADDED, {
      comment,
      reaction,
      review,
    } as ReviewCommentReactionAddedEventParams);
  }

  protected onCommentReactionRemoved(
    review: ScenarioSessionReview,
    comment: ScenarioSessionReviewComment,
    removedReaction: ScenarioSessionReviewCommentReaction,
  ): void {
    this.eventEmitter.emit(
      ScenarioSessionReviewEvents.COMMENT_REACTION_REMOVED,
      {
        comment,
        removedReaction,
        review,
      } as ReviewCommentReactionRemovedEventParams,
    );
  }
}
