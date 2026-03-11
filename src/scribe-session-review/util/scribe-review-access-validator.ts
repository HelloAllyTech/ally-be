import { ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { BaseReview } from 'src/review/entity/base-review.entity';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ReviewAccessValidator } from 'src/review/util/review-access-policy.util';

@Injectable()
export class ScribeReviewAccessValidator extends ReviewAccessValidator {
  constructor(private readonly permissionValidator: PermissionValidator) {
    super();
  }

  getReviewerAccessPermission(): string {
    return PERMISSIONS.SCRIBE_REVIEWER_ACCESS;
  }

  async validateAccess(review: BaseReview, userId: number): Promise<void> {
    const isScribeReviewer = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.SCRIBE_REVIEWER_ACCESS],
    );
    const isCounselor = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.COUNSELOR_ACCESS],
    );

    if (
      (isScribeReviewer &&
        review.tenantId !== ExecutionManager.getTenantId()) ||
      (!isScribeReviewer && isCounselor && review.createdBy !== userId)
    ) {
      throw new ForbiddenException('You are not allowed to access this review');
    }
  }
}
