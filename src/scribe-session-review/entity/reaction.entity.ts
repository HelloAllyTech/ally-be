import { Entity } from 'typeorm';
import { BaseReviewReaction } from 'src/review/entity/base-review-reaction.entity';

@Entity('scribe_session_review_reactions')
export class ScribeSessionReviewReaction extends BaseReviewReaction {}
