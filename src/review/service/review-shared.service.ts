import { Injectable } from '@nestjs/common';
import { ReviewCommentReactionRepository } from '../repository/review-comment-reaction.repository';
import { ReviewCommentRepository } from '../repository/review-comment.repository';
import { ReviewReactionRepository } from '../repository/review-reaction.repository';
import { ReviewRepository } from '../repository/review.repository';

@Injectable()
export class ReviewSharedService {
  constructor(
    private readonly reviewRepository: ReviewRepository,
    private readonly reviewReactionRepository: ReviewReactionRepository,
    private readonly reviewCommentRepository: ReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ReviewCommentReactionRepository,
  ) {}

  async getReviewByScenarioSessionId(scenarioSessionId: string) {
    return this.reviewRepository.findOne({ where: { scenarioSessionId } });
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

  async getGivenRepliesCountAsReviewOwner(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewCommentRepository.getGivenRepliesCountAsReviewOwner(
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

  async getReceivedRepliesCountAsCommenter(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; count: number }[]> {
    return this.reviewCommentRepository.getReceivedRepliesCountAsCommenter(
      tenantIds,
      userIds,
    );
  }
}
