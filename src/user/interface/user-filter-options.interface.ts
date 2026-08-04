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
  /**
   * Opt in to listing holders of a platform role (SUPER_ADMIN_ROLES), who are
   * filtered out of this list by default so a tenant's user list only ever
   * shows that tenant's own people. Honoured only for callers who can manage
   * the super-admin tier (view:super-duper-admins) — see
   * UserService.getAllUsers, which rejects the flag for anyone else rather than
   * silently ignoring it.
   */
  includePlatformAdmins?: boolean;
}

export interface MinimalTenantData {
  name: string;
  logoUrl?: string;
}
