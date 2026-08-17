import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../guards/permissions.guard';
import { FeatureToggleGuard } from '../guards/feature-toggle.guard';
import { RequirePermissions } from './permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PreferenceName, UserRole } from 'src/common/constants/user.constants';

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
  /**
   * Org-level escape hatch: a caller whose *tenant* has this preference switched
   * on also passes, without a per-user toggle row. This is how a surface built
   * for platform admins is opened to a tenant's own admins — `admin_feature_toggles`
   * only ever has rows for PLATFORM_ADMIN accounts, so without this a tenant
   * admin holding the right permission would still 403.
   *
   * Unlike `legacyRoles` this is permanent, not a rollout window. It never
   * widens *what* the caller may do: PermissionsGuard has already run, so the
   * per-role permission set still decides read vs. write.
   */
  tenantPreference?: PreferenceName;
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
  options: {
    legacyRoles?: UserRole[];
    permissions?: string[];
    tenantPreference?: PreferenceName;
  } = {},
) {
  const permissions = options.permissions ?? [PERMISSIONS.SYSTEM_ACCESS];
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard, FeatureToggleGuard),
    RequirePermissions(permissions, 'AND'),
    SetMetadata(FEATURE_TOGGLE_KEY, {
      featureKey,
      legacyRoles: options.legacyRoles,
      tenantPreference: options.tenantPreference,
    } as FeatureToggleOptions),
  );
}
