import { SortOrder } from 'src/common/type/common.type';

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
