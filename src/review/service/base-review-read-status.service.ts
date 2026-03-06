import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { BaseReview } from '../entity/base-review.entity';
import { BaseReviewReadStatus } from '../entity/base-review-read-status.entity';
import { BaseReviewReadStatusRepository } from '../repository/base-review-read-status.repository';

export abstract class BaseReviewReadStatusService<
  TReview extends BaseReview,
  TReadStatus extends BaseReviewReadStatus,
> {
  protected abstract readonly reviewRepository: Repository<TReview>;
  protected abstract readonly reviewReadStatusRepository: BaseReviewReadStatusRepository<
    TReadStatus,
    TReview
  >;
  protected abstract readonly permissionValidator: PermissionValidator;

  async getUnreadReviewCount(): Promise<{ count: number }> {
    const userId = Number(ExecutionManager.getUserId());
    const tenantId = ExecutionManager.getTenantId();
    if (!userId) {
      throw new BadRequestException('User not found');
    }
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }
    const isReviewer = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.REVIEWER_ACCESS],
    );
    if (!isReviewer) {
      throw new ForbiddenException(
        'Only reviewers can access unread review count',
      );
    }
    const count = await this.reviewReadStatusRepository.getUnreadCount(
      userId,
      tenantId,
    );
    return { count };
  }

  async markReviewAsRead(reviewId: string): Promise<SuccessResponse> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }
    const isReviewer = await this.permissionValidator.validatePermissions(
      userId,
      [PERMISSIONS.REVIEWER_ACCESS],
    );
    if (!isReviewer) {
      throw new ForbiddenException('Only reviewers can mark reviews as read');
    }
    const review = await this.reviewRepository.findOne({
      where: { id: reviewId, tenantId } as any,
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    await this.reviewReadStatusRepository.markAsRead(userId, reviewId);
    return { success: true };
  }
}
