import { BaseReviewCommentReaction } from '../entity/base-review-comment-reaction.entity';
import { BaseReviewComment } from '../entity/base-review-comment.entity';
import { BaseReviewReaction } from '../entity/base-review-reaction.entity';
import { BaseReview } from '../entity/base-review.entity';

export enum ScenarioSessionReviewEvents {
  COMMENT_ADDED = 'SCENARIO_SESSION_REVIEW_COMMENT_ADDED',
  COMMENT_REMOVED = 'SCENARIO_SESSION_REVIEW_COMMENT_REMOVED',
  COMMENT_REACTION_ADDED = 'SCENARIO_SESSION_REVIEW_COMMENT_REACTION_ADDED',
  COMMENT_REACTION_REMOVED = 'SCENARIO_SESSION_REVIEW_COMMENT_REACTION_REMOVED',
  REACTION_ADDED = 'SCENARIO_SESSION_REVIEW_REACTION_ADDED',
  REACTION_REMOVED = 'SCENARIO_SESSION_REVIEW_REACTION_REMOVED',
}

export interface ReviewCommentAddedEventParams {
  review: BaseReview;
  comment: BaseReviewComment;
}

export interface ReviewReactionAddedEventParams {
  review: BaseReview;
  reaction: BaseReviewReaction;
}

export interface ReviewCommentReactionAddedEventParams {
  reaction: BaseReviewCommentReaction;
  comment: BaseReviewComment;
  review: BaseReview;
}

export interface ReviewCommentReactionRemovedEventParams {
  removedReaction: BaseReviewCommentReaction;
  comment: BaseReviewComment;
  review: BaseReview;
}

export interface ReviewReactionRemovedEventParams {
  removedReaction: BaseReviewReaction;
  review: BaseReview;
}

export interface ReviewCommentRemovedEventParams {
  review: BaseReview;
  comment: BaseReviewComment;
  commentReplies?: BaseReviewComment[];
  commentReactions?: BaseReviewCommentReaction[];
  commentReplyReactions?: BaseReviewCommentReaction[];
}
