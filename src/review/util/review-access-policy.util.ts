import { ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { BaseReview } from '../entity/base-review.entity';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';

@Injectable()
export class ReviewAccessValidator {
  constructor(private readonly permissionValidator: PermissionValidator) {}

  async validateAccess(review: BaseReview, userId: number) {
    const isReviewer = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.REVIEWER_ACCESS],
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
