import { Injectable } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewReactionRepository } from '../repository/reaction.repository';
import { ScribeSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScribeSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';
import { ScribeSessionReview } from '../entity/review.entity';
import { ScribeSessionReviewThread } from '../entity/thread.entity';
import { ScribeSessionReviewComment } from '../entity/comment.entity';
import { ScribeSessionReviewCommentReaction } from '../entity/comment-reaction.entity';
import { ScribeSessionReviewReaction } from '../entity/reaction.entity';
import { ScribeSessionReviewReadStatus } from '../entity/read-status.entity';
import { ReviewStatus } from 'src/review/type/review.type';

@Injectable()
export class ScribeSessionReviewSharedService {
  constructor(
    private readonly reviewRepository: ScribeSessionReviewRepository,
    private readonly reviewReactionRepository: ScribeSessionReviewReactionRepository,
    private readonly reviewCommentRepository: ScribeSessionReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ScribeSessionReviewCommentReactionRepository,
  ) {}

  async getReviewByScribeSessionId(
    scribeSessionId: number,
    status?: ReviewStatus,
  ) {
    return this.reviewRepository.findOne({
      where: { scribeSessionId, ...(status ? { status } : {}) },
    });
  }

  async getGivenCommentsReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewCommentReactionRepository.getGivenCommentsReactionsCountPerUser(
      tenantIds,
      userIds,
    );
  }

  async getReceivedCommentsReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewCommentReactionRepository.getReceivedCommentsReactionsCountPerUser(
      tenantIds,
      userIds,
    );
  }

  async getGivenReviewReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewReactionRepository.getGivenReviewReactionsCountPerUser(
      tenantIds,
      userIds,
    );
  }

  async getReceivedReviewReactionsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewReactionRepository.getReceivedReviewReactionsCountPerUser(
      tenantIds,
      userIds,
    );
  }

  async getGivenCommentsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewCommentRepository.getGivenCommentsCountPerUser(
      tenantIds,
      userIds,
    );
  }

  async getReceivedCommentsCountPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewCommentRepository.getReceivedCommentsCountPerUser(
      tenantIds,
      userIds,
    );
  }

  async deleteReviewByScribeSessionId(
    scribeSessionId: number,
    entityManager: EntityManager,
  ) {
    const review = await this.getReviewByScribeSessionId(scribeSessionId);
    if (!review) return;

    const threads = await entityManager.find(ScribeSessionReviewThread, {
      where: { reviewId: review.id },
      withDeleted: true,
    });
    const threadIds = threads.map((thread) => thread.id);

    if (threadIds.length > 0) {
      const comments = await entityManager.find(ScribeSessionReviewComment, {
        where: { reviewThreadId: In(threadIds) },
        withDeleted: true,
      });
      const commentIds = comments.map((comment) => comment.id);

      if (commentIds.length > 0) {
        await entityManager.delete(ScribeSessionReviewCommentReaction, {
          reviewCommentId: In(commentIds),
        });
      }
      await entityManager.delete(ScribeSessionReviewComment, {
        reviewThreadId: In(threadIds),
      });
    }

    await Promise.all([
      entityManager.delete(ScribeSessionReviewThread, { reviewId: review.id }),
      entityManager.delete(ScribeSessionReviewReaction, {
        reviewId: review.id,
      }),
      entityManager.delete(ScribeSessionReviewReadStatus, {
        reviewId: review.id,
      }),
    ]);
    await entityManager.delete(ScribeSessionReview, { id: review.id });
  }
}
