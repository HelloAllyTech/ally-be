import { Injectable } from '@nestjs/common';
import { ScenarioSessionReviewRepository } from '../repository/review.repository';
import { ScenarioSessionReviewReactionRepository } from '../repository/reaction.repository';
import { ScenarioSessionReviewCommentRepository } from '../repository/comment.repository';
import { ScenarioSessionReviewCommentReactionRepository } from '../repository/comment-reaction.repository';

@Injectable()
export class ScenarioSessionReviewSharedService {
  constructor(
    private readonly reviewRepository: ScenarioSessionReviewRepository,
    private readonly reviewReactionRepository: ScenarioSessionReviewReactionRepository,
    private readonly reviewCommentRepository: ScenarioSessionReviewCommentRepository,
    private readonly reviewCommentReactionRepository: ScenarioSessionReviewCommentReactionRepository,
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
