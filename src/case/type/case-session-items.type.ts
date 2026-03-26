import { SortOrder } from 'src/common/type/common.type';

export interface CaseSessionFilterOptions {
  limit?: number;
  offset?: number;
  sortBy?: CaseSessionSortBy;
  order?: SortOrder;
  languageCode?: string;
}

export enum CaseSessionSortBy {
  CREATED_AT = 'createdAt',
  UPDATED_AT = 'updatedAt',
}
