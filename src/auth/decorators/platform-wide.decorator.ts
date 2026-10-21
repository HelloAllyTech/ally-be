import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PlatformWideGuard } from '../guards/platform-wide.guard';
import { RequirePermissions } from './permissions.decorator';

/**
 * @AuthPermissions for a route that reaches every organization at once and
 * cannot be narrowed to some: the caller also must not be a platform admin
 * restricted to an organization allowlist (see PlatformWideGuard).
 *
 * For a route that names one organization, use @TenantScopedPermissions
 * instead — that one lets a restricted admin act on their own orgs.
 */
export function PlatformWidePermissions(
  permissions: string[],
  operator: 'AND' | 'OR' = 'AND',
) {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard, PlatformWideGuard),
    RequirePermissions(permissions, operator),
  );
}
