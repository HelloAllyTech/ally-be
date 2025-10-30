import { SortOrder, UserSortBy } from '../enum/user.enum';

export interface UserFilterOptions {
  limit?: number;
  offset?: number;
  sortBy?: UserSortBy;
  order?: SortOrder;
  tenantIds?: string;
  roles?: string;
  statuses?: string;
  search?: string;
}
