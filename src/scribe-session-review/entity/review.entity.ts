import { Column, Entity } from 'typeorm';
import { BaseReview } from 'src/review/entity/base-review.entity';

@Entity('scribe_session_reviews')
export class ScribeSessionReview extends BaseReview {
  @Column()
  scribeSessionId!: number;
}
