import { Entity } from 'typeorm';
import { BaseReviewComment } from 'src/review/entity/base-review-comment.entity';

@Entity('scribe_session_review_comments')
export class ScribeSessionReviewComment extends BaseReviewComment {}
