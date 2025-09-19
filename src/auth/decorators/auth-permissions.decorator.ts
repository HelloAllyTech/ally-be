import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermissions } from './permissions.decorator';

/**
 * Combined decorator that applies JWT authentication and permission checking
 * @param permissions - List of permission strings required to access the endpoint
 * @example @AuthPermissions(PERMISSIONS.ReadUser, PERMISSIONS.WriteUser)
 */
export function AuthPermissions(...permissions: string[]) {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard),
    RequirePermissions(...permissions),
  );
}
