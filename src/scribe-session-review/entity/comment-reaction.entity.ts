import { Entity } from 'typeorm';
import { BaseReviewCommentReaction } from 'src/review/entity/base-review-comment-reaction.entity';

@Entity('scribe_session_review_comment_reactions')
export class ScribeSessionReviewCommentReaction extends BaseReviewCommentReaction {}
