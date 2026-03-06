import { Entity } from 'typeorm';
import { BaseReviewReaction } from 'src/review/entity/base-review-reaction.entity';

@Entity('scenario_session_review_reactions')
export class ScenarioSessionReviewReaction extends BaseReviewReaction {}
