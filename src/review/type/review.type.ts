import { Pagination, SortOrder } from 'src/common/type/common.type';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';
import { Scenarios } from 'src/learn/entity/scenarios.entity';
import { User } from 'src/user/entity/user.entity';

export enum ReviewStatus {
  HIDDEN = 'HIDDEN',
  IN_REVIEW = 'IN_REVIEW',
}

export enum ReviewSortBy {
  ALL = 'ALL',
  LATEST = 'LATEST',
  MOST_REVIEWED = 'MOST_REVIEWED',
  UNDISCOVERED = 'UNDISCOVERED',
}

export interface GetReviewsOptions {
  limit?: number;
  offset?: number;
  sortBy?: ReviewSortBy;
  sortOrder?: SortOrder;
}

export interface GetReviews {
  reviews: Reviews[];
  count: number;
  reactions: Array<{ reviewId: string; reaction: string; count: number }>;
  comments: Array<{ reviewId: string; count: number }>;
}

export interface ReviewsResult {
  reviews: Reviews[];
  count: number;
}

export interface Reviews {
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  id: string;
  scenarioSessionId: string;
  createdBy: User;
  status: string;
  scenarioSession: ScenarioSessions;
  scenario: Scenarios;
}

export enum ReactionAction {
  ADD = 'ADD',
  REMOVE = 'REMOVE',
}

export interface ReviewReactionOptions {
  limit?: number;
  offset?: number;
  reaction?: string;
}

export interface GetReviewThreadsOptions extends Pagination {
  includeMessage?: boolean;
}
