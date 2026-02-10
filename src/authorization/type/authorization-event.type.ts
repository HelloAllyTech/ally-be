export enum AuthorizationEvents {
  USER_ROLE_ASSIGNED = 'USER_ROLE_ASSIGNED',
}

export interface UserRoleAssignedEventParams {
  userId: number;
  groupId: number;
  tenantId?: string;
}

export enum PermissionOperator {
  OR = 'OR',
  AND = 'AND',
}
