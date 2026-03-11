import { ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { BaseReview } from 'src/review/entity/base-review.entity';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ReviewAccessValidator } from 'src/review/util/review-access-policy.util';

@Injectable()
export class ScenarioReviewAccessValidator extends ReviewAccessValidator {
  constructor(private readonly permissionValidator: PermissionValidator) {
    super();
  }

  getReviewerAccessPermission(): string {
    return PERMISSIONS.SIMULATION_REVIEWER_ACCESS;
  }

  async validateAccess(review: BaseReview, userId: number): Promise<void> {
    const isReviewer = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.SIMULATION_REVIEWER_ACCESS],
    );
    const isLearner = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.LEARNER_ACCESS],
    );

    if (
      (isReviewer && review.tenantId !== ExecutionManager.getTenantId()) ||
      (!isReviewer && isLearner && review.createdBy !== userId)
    ) {
      throw new ForbiddenException('You are not allowed to access this review');
    }
  }
}
