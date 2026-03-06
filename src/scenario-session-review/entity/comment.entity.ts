import { Entity } from 'typeorm';
import { BaseReviewComment } from 'src/review/entity/base-review-comment.entity';

@Entity('scenario_session_review_comments')
export class ScenarioSessionReviewComment extends BaseReviewComment {}
