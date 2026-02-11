import { SortOrder } from 'src/common/type/common.type';

export interface CaseSessionFilterOptions {
  limit?: number;
  offset?: number;
  sortBy?: CaseSessionSortBy;
  order?: SortOrder;
}

export enum CaseSessionSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}
