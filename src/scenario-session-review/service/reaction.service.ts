import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from 'src/logger/logger.service';
import { UserService } from 'src/user/service/user.service';
import { BaseReviewReactionService } from 'src/review/service/base-review-reaction.service';
import { ScenarioReviewAccessValidator } from '../util/scenario-review-access-validator';
import {
  ScenarioSessionReviewEvents,
  ReviewReactionAddedEventParams,
  ReviewReactionRemovedEventParams,
} from 'src/review/type/review-event.type';
import { ScenarioSessionReview } from '../entity/review.entity';
import { ScenarioSessionReviewReaction } from '../entity/reaction.entity';
import { ScenarioSessionReviewRepository } from '../repository/review.repository';
import { ScenarioSessionReviewReactionRepository } from '../repository/reaction.repository';

@Injectable()
export class ScenarioSessionReviewReactionService extends BaseReviewReactionService<
  ScenarioSessionReview,
  ScenarioSessionReviewReaction
> {
  protected readonly logger = LoggerService.getInstance(
    ScenarioSessionReviewReactionService.name,
  );

  constructor(
    protected readonly reviewRepository: ScenarioSessionReviewRepository,
    protected readonly reviewReactionRepository: ScenarioSessionReviewReactionRepository,
    protected readonly userService: UserService,
    private readonly eventEmitter: EventEmitter2,
    protected readonly reviewAccessValidator: ScenarioReviewAccessValidator,
  ) {
    super();
  }

  protected onReactionAdded(
    review: ScenarioSessionReview,
    reaction: ScenarioSessionReviewReaction,
  ): void {
    this.eventEmitter.emit(ScenarioSessionReviewEvents.REACTION_ADDED, {
      review,
      reaction,
    } as ReviewReactionAddedEventParams);
  }

  protected onReactionRemoved(
    review: ScenarioSessionReview,
    removedReaction: ScenarioSessionReviewReaction,
  ): void {
    this.eventEmitter.emit(ScenarioSessionReviewEvents.REACTION_REMOVED, {
      review,
      removedReaction,
    } as ReviewReactionRemovedEventParams);
  }
}
