import { Entity, Index } from 'typeorm';
import { BaseReviewReadStatus } from 'src/review/entity/base-review-read-status.entity';

@Entity('scenario_session_review_read_status')
@Index(
  'uq_scenario_session_review_read_status_user_review_idx',
  ['userId', 'reviewId'],
  { unique: true },
)
export class ScenarioSessionReviewReadStatus extends BaseReviewReadStatus {}
