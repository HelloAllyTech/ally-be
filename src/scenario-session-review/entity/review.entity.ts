import { Column, Entity } from 'typeorm';
import { BaseReview } from 'src/review/entity/base-review.entity';

@Entity('scenario_session_reviews')
export class ScenarioSessionReview extends BaseReview {
  @Column({ type: 'uuid' })
  scenarioSessionId!: string;
}
