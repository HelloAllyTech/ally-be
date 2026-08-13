import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../guards/permissions.guard';
import { FeatureToggleGuard } from '../guards/feature-toggle.guard';
import { RequirePermissions } from './permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { UserRole } from 'src/common/constants/user.constants';

export const FEATURE_TOGGLE_KEY = 'feature-toggle';

export interface FeatureToggleOptions {
  featureKey: FeatureToggleKey;
  /**
   * Rollout-window escape hatch: while the frontend/backend deploy is mid-flight,
   * a caller holding one of these legacy role names also passes, even without the
   * toggle row. Remove this option (and the field) from every call site once the
   * migration backfill is confirmed correct in production — see the "Remove the
   * legacy branch" step in the role-collapse rollout plan.
   */
  legacyRoles?: UserRole[];
}

/**
 * @RequireFeatureToggle(key, options?)
 *
 * Combined decorator for the ~21 surfaces formerly gated by
 * @AuthRoles(SUPER_ADMIN_ROLES) / @AuthRoles(SUPER_DUPER_ADMIN_ROLES). Applies,
 * within a single @UseGuards so execution order is guaranteed:
 *   1. AuthGuard('jwt')     → populates request.user
 *   2. PermissionsGuard     → the coarse permission every PLATFORM_ADMIN carries
 *                             (defaults to SYSTEM_ACCESS)
 *   3. FeatureToggleGuard   → the per-user narrowing check; fails closed on a
 *                             missing/false toggle row
 *
 * @example
 *   @RequireFeatureToggle(FeatureToggleKey.AI_LAB)
 *   @Get('ai-lab')
 */
export function RequireFeatureToggle(
  featureKey: FeatureToggleKey,
  options: { legacyRoles?: UserRole[]; permissions?: string[] } = {},
) {
  const permissions = options.permissions ?? [PERMISSIONS.SYSTEM_ACCESS];
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard, FeatureToggleGuard),
    RequirePermissions(permissions, 'AND'),
    SetMetadata(FEATURE_TOGGLE_KEY, {
      featureKey,
      legacyRoles: options.legacyRoles,
    } as FeatureToggleOptions),
  );
}
