import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  CreateReviewCommentDto,
  CreateCommentResponseDto,
} from '../dto/create-comment.dto';
import { ReviewComment } from '../entity/review-comment.entity';
import { ReviewThread } from '../entity/review-thread.entity';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewStatus } from '../type/review.type';
import { ReviewRepository } from '../repository/review.repository';
import { ReviewThreadRepository } from '../repository/review-thread.repository';

@Injectable()
export class ReviewCommentService {
  private readonly logger = LoggerService.getInstance(
    ReviewCommentService.name,
  );
  constructor(
    private readonly dataSource: DataSource,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewThreadRepository: ReviewThreadRepository,
    private readonly permissionValidator: PermissionValidator,
  ) {}

  async addCommentToReview(
    reviewId: string,
    createReviewCommentDto: CreateReviewCommentDto,
  ): Promise<CreateCommentResponseDto> {
    const userId = Number(ExecutionManager.getUserId());
    if (!userId) {
      throw new BadRequestException('User not found');
    }

    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new BadRequestException('Tenant not found');
    }

    const review = await this.reviewRepository.findOne({
      where: {
        id: reviewId,
        status: ReviewStatus.IN_REVIEW,
        tenantId,
      },
    });
    if (!review) {
      throw new NotFoundException('Review not found');
    }

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

    if (!createReviewCommentDto.content.trim()) {
      throw new BadRequestException('Content cannot be empty');
    }

    if (createReviewCommentDto.threadId) {
      const thread = await this.reviewThreadRepository.findOne({
        where: {
          id: createReviewCommentDto.threadId,
        },
      });
      if (!thread) {
        throw new NotFoundException('Review thread not found');
      }

      const comment = this.reviewCommentRepository.create({
        reviewThreadId: thread.id,
        content: createReviewCommentDto.content,
        createdBy: Number(userId),
        tenantId,
      });
      await this.reviewCommentRepository.save(comment);

      return {
        commentId: comment.id,
      };
    }

    if (createReviewCommentDto.parentCommentId) {
      const parentComment = await this.reviewCommentRepository.findOne({
        where: {
          id: createReviewCommentDto.parentCommentId,
        },
      });

      if (!parentComment) {
        throw new BadRequestException('Invalid parent comment');
      }

      const reply = this.reviewCommentRepository.create({
        reviewThreadId: parentComment.reviewThreadId,
        content: createReviewCommentDto.content,
        createdBy: Number(userId),
        parentCommentId: createReviewCommentDto.parentCommentId,
        tenantId,
      });
      await this.reviewCommentRepository.save(reply);
      return {
        replyId: reply.id,
      };
    }

    if (
      !createReviewCommentDto.threadId &&
      !createReviewCommentDto.parentCommentId
    ) {
      if (!createReviewCommentDto.messageId) {
        throw new BadRequestException('messageId required for new threads');
      }
      if (!createReviewCommentDto.selection) {
        throw new BadRequestException('selection required for new threads');
      }
      try {
        const result = await this.dataSource.transaction(
          async (entityManager) => {
            const thread = entityManager.create(ReviewThread, {
              reviewId,
              messageId: createReviewCommentDto.messageId,
              createdBy: Number(userId),
              selection: createReviewCommentDto.selection,
              tenantId,
            });
            await entityManager.save(ReviewThread, thread);
            const comment = entityManager.create(ReviewComment, {
              reviewThreadId: thread.id,
              content: createReviewCommentDto.content,
              createdBy: Number(userId),
              tenantId,
            });
            await entityManager.save(ReviewComment, comment);
            return {
              threadId: thread.id,
              commentId: comment.id,
            };
          },
        );

        return result;
      } catch (error) {
        this.logger.error(
          `Failed to add comment: ${error.message}`,
          error.stack,
        );
        throw new BadRequestException(
          `Failed to add comment: ${error.message}`,
        );
      }
    }
    throw new BadRequestException('Invalid request');
  }
}
