import { Entity } from 'typeorm';
import { BaseReviewThread } from 'src/review/entity/base-review-thread.entity';

@Entity('scribe_session_review_threads')
export class ScribeSessionReviewThread extends BaseReviewThread {}
