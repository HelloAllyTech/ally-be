import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to specify required permissions for a route or controller
 * @param permissions - List of permission strings required to access the endpoint
 * @example @RequirePermissions([PERMISSIONS.ReadUser, PERMISSIONS.WriteUser])
 */
export const RequirePermissions = (
  permissions: string[],
  operator: 'AND' | 'OR' = 'AND',
) => SetMetadata(PERMISSIONS_KEY, { permissions, operator });
