import { Entity } from 'typeorm';
import { BaseReviewThread } from 'src/review/entity/base-review-thread.entity';

@Entity('scenario_session_review_threads')
export class ScenarioSessionReviewThread extends BaseReviewThread {}
