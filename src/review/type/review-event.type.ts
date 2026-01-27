import { ReviewCommentReaction } from '../entity/review-comment-reaction.entity';
import { ReviewComment } from '../entity/review-comment.entity';
import { ReviewReaction } from '../entity/review-reaction.entity';
import { Review } from '../entity/review.entity';

export enum ReviewEvents {
  REVIEW_COMMENT_ADDED = 'REVIEW_COMMENT_ADDED',
  REVIEW_COMMENT_REMOVED = 'REVIEW_COMMENT_REMOVED',
  REVIEW_COMMENT_REACTION_ADDED = 'REVIEW_COMMENT_REACTION_ADDED',
  REVIEW_COMMENT_REACTION_REMOVED = 'REVIEW_COMMENT_REACTION_REMOVED',
  REVIEW_REACTION_ADDED = 'REVIEW_REACTION_ADDED',
  REVIEW_REACTION_REMOVED = 'REVIEW_REACTION_REMOVED',
}

export interface ReviewCommentAddedEventParams {
  review: Review;
  comment: ReviewComment;
}

export interface ReviewReactionAddedEventParams {
  review: Review;
  reaction: ReviewReaction;
}

export interface ReviewCommentReactionAddedEventParams {
  reaction: ReviewCommentReaction;
  comment: ReviewComment;
}

export interface ReviewCommentReactionRemovedEventParams {
  removedReaction: ReviewCommentReaction;
  comment: ReviewComment;
}

export interface ReviewReactionRemovedEventParams {
  removedReaction: ReviewReaction;
  review: Review;
}

export interface ReviewCommentRemovedEventParams {
  review: Review;
  comment: ReviewComment;
}
