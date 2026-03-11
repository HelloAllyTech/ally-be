import { BaseReview } from '../entity/base-review.entity';

export abstract class ReviewAccessValidator {
  abstract validateAccess(review: BaseReview, userId: number): Promise<void>;
  abstract getReviewerAccessPermission(): string;
}
