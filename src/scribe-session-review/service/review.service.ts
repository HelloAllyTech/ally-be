import { Injectable } from '@nestjs/common';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { BaseReviewReadStatusService } from 'src/review/service/base-review-read-status.service';
import { ScribeSessionReview } from '../entity/review.entity';
import { ScribeSessionReviewReadStatus } from '../entity/read-status.entity';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewReadStatusRepository } from '../repository/read-status.repository';

@Injectable()
export class ScribeSessionReviewService extends BaseReviewReadStatusService<
  ScribeSessionReview,
  ScribeSessionReviewReadStatus
> {
  constructor(
    protected readonly reviewRepository: ScribeSessionReviewRepository,
    protected readonly reviewReadStatusRepository: ScribeSessionReviewReadStatusRepository,
    protected readonly permissionValidator: PermissionValidator,
  ) {
    super();
  }
}
