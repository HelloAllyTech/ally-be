import { Injectable } from '@nestjs/common';
import { ScribeSessionReviewRepository } from '../repository/review.repository';
import { ScribeSessionReviewReactionRepository } from '../repository/reaction.repository';
import { ScribeSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScribeSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';

@Injectable()
export class ScribeSessionReviewSharedService {
  constructor(
    private readonly reviewRepository: ScribeSessionReviewRepository,
    private readonly reviewReactionRepository: ScribeSessionReviewReactionRepository,
    private readonly reviewCommentRepository: ScribeSessionReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ScribeSessionReviewCommentReactionRepository,
  ) {}

  async getReviewByScribeSessionId(scribeSessionId: number) {
    return this.reviewRepository.findOne({ where: { scribeSessionId } });
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
}
