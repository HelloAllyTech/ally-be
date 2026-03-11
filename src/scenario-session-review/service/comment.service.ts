import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from 'src/logger/logger.service';
import { UserService } from 'src/user/service/user.service';
import { BaseReviewCommentService } from 'src/review/service/base-review-comment.service';
import { ScenarioReviewAccessValidator } from '../util/scenario-review-access-validator';
import {
  ScenarioSessionReviewEvents,
  ReviewCommentAddedEventParams,
  ReviewCommentRemovedEventParams,
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
export class ScenarioSessionReviewCommentService extends BaseReviewCommentService<
  ScenarioSessionReview,
  ScenarioSessionReviewThread,
  ScenarioSessionReviewComment,
  ScenarioSessionReviewCommentReaction
> {
  protected readonly logger = LoggerService.getInstance(
    ScenarioSessionReviewCommentService.name,
  );

  constructor(
    protected readonly dataSource: DataSource,
    protected readonly reviewRepository: ScenarioSessionReviewRepository,
    protected readonly reviewThreadRepository: ScenarioSessionReviewThreadRepository,
    protected readonly reviewCommentRepository: ScenarioSessionReviewCommentRepository,
    protected readonly reviewCommentReactionRepository: ScenarioSessionReviewCommentReactionRepository,
    protected readonly userService: UserService,
    private readonly eventEmitter: EventEmitter2,
    protected readonly reviewAccessValidator: ScenarioReviewAccessValidator,
  ) {
    super();
  }

  protected getThreadEntityClass() {
    return ScenarioSessionReviewThread;
  }

  protected getCommentEntityClass() {
    return ScenarioSessionReviewComment;
  }

  protected getCommentReactionEntityClass() {
    return ScenarioSessionReviewCommentReaction;
  }

  protected onCommentAdded(
    review: ScenarioSessionReview,
    comment: ScenarioSessionReviewComment,
  ): void {
    this.eventEmitter.emit(ScenarioSessionReviewEvents.COMMENT_ADDED, {
      review,
      comment,
    } as ReviewCommentAddedEventParams);
  }

  protected onCommentRemoved(
    review: ScenarioSessionReview,
    comment: ScenarioSessionReviewComment,
    commentReplies?: ScenarioSessionReviewComment[],
    commentReactions?: ScenarioSessionReviewCommentReaction[],
    commentReplyReactions?: ScenarioSessionReviewCommentReaction[],
  ): void {
    this.eventEmitter.emit(ScenarioSessionReviewEvents.COMMENT_REMOVED, {
      review,
      comment,
      commentReplies,
      commentReactions,
      commentReplyReactions,
    } as ReviewCommentRemovedEventParams);
  }
}
