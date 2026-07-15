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
  MOST_COMMENTED = 'MOST_COMMENTED',
  MOST_VIEWED = 'MOST_VIEWED',
}

export enum ReadFilter {
  ALL = 'ALL',
  READ = 'READ',
  UNREAD = 'UNREAD',
}

export interface GetReviewsOptions {
  limit?: number;
  offset?: number;
  sortBy?: ReviewSortBy;
  sortOrder?: SortOrder;
  languageCode?: string;
  readFilter?: ReadFilter;
  scenarioId?: number;
  excludeOwn?: boolean;
}
