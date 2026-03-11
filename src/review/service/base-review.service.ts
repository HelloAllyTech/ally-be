import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { SuccessResponse } from 'src/common/type/common.type';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { BaseReview } from '../entity/base-review.entity';
import { ReviewAccessValidator } from '../util/review-access-policy.util';
import { BaseReviewReadStatus } from '../entity/base-review-read-status.entity';
import { BaseReviewReadStatusRepository } from '../repository/base-review-read-status.repository';
import { UpdateReviewDto } from '../dto/update-review.dto';
import { NOTE_EDIT_WINDOW_MS } from '../constant/review.constant';
import { TIME } from 'src/common/constants/time.constants';

export abstract class BaseReviewService<
  TReview extends BaseReview,
  TReadStatus extends BaseReviewReadStatus,
> {
  protected abstract readonly reviewRepository: Repository<TReview>;
  protected abstract readonly reviewReadStatusRepository: BaseReviewReadStatusRepository<
    TReadStatus,
    TReview
  >;
  protected abstract readonly permissionValidator: PermissionValidator;
  protected abstract readonly reviewAccessValidator: ReviewAccessValidator;

  async updateReview(
    id: string,
    updateReviewDto: UpdateReviewDto,
  ): Promise<SuccessResponse> {
    const userId = ExecutionManager.getUserId();
    if (!userId) {
      throw new BadRequestException('User not found');
    }
    const review = await this.reviewRepository.findOne({
      where: { id, createdBy: Number(userId) } as any,
    });
    if (!review) {
      throw new BadRequestException('Review not found');
    }

    const hasNoteUpdated = updateReviewDto.note !== undefined;
    if (hasNoteUpdated) {
      const elapsed = new Date().getTime() - review.createdAt.getTime();
      if (elapsed > NOTE_EDIT_WINDOW_MS) {
        throw new ForbiddenException(
          `Note can only be edited within ${NOTE_EDIT_WINDOW_MS / TIME.MINUTE_IN_MS} minutes of review creation`,
        );
      }
    }

    const updates: Partial<TReview> = { ...review };

    if (updateReviewDto.status !== undefined) {
      updates.status = updateReviewDto.status;
    }
    if (hasNoteUpdated) {
      updates.note = updateReviewDto.note;
      updates.noteEditedAt = new Date();
    }

    const updatedReview = this.reviewRepository.create(updates as any);
    await this.reviewRepository.save(updatedReview);
    return { success: true };
  }

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
      [this.reviewAccessValidator.getReviewerAccessPermission()],
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
      [this.reviewAccessValidator.getReviewerAccessPermission()],
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
