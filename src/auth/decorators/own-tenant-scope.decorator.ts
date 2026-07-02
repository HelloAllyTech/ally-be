import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../guards/permissions.guard';
import { OwnTenantScopeGuard } from '../guards/own-tenant-scope.guard';
import { RequirePermissions } from './permissions.decorator';

export const OWN_TENANT_SCOPE_KEY = 'own-tenant-scope';

/**
 * Options controlling where OwnTenantScopeGuard reads the target tenant id
 * from. Defaults match the shapes used across the tenant-assignment
 * endpoints, so most usages need no options.
 */
export interface OwnTenantScopeOptions {
  /** Route param that holds the target tenant id. Default: 'tenantId'. */
  paramName?: string;
  /** Body field that holds a single target tenant id. Default: 'tenantId'. */
  bodyParamName?: string;
  /**
   * Body field that holds an array of target tenant ids (badge endpoints).
   * Default: 'tenantIds'.
   */
  bodyArrayName?: string;
}

/**
 * @TenantScopedPermissions([...perms], options?, operator?)
 *
 * Combined decorator for tenant-scoped content-access endpoints. Applies —
 * in this exact order, within a SINGLE @UseGuards so execution order is
 * guaranteed:
 *   1. AuthGuard('jwt')      → populates request.user
 *   2. PermissionsGuard      → checks the required permission(s)
 *   3. OwnTenantScopeGuard   → for non-SYSTEM_ACCESS callers, pins the target
 *                              tenant to the caller's own JWT tenant
 *
 * Ordering matters: OwnTenantScopeGuard needs request.user, which only exists
 * after AuthGuard runs — so the guards MUST live in one UseGuards call, not
 * stacked across separate decorators (stacking does not guarantee order).
 *
 * A SUPER_ADMIN / MULTI_TENANT_ADMIN (SYSTEM_ACCESS) passes the scope guard
 * unconditionally, preserving their existing cross-tenant behaviour.
 *
 * @example
 *   @TenantScopedPermissions([PERMISSIONS.EDIT_SCENARIO_TENANT])
 *   @Post('scenario/tenant/:tenantId')
 */
export function TenantScopedPermissions(
  permissions: string[],
  options: OwnTenantScopeOptions = {},
  operator: 'AND' | 'OR' = 'AND',
) {
  return applyDecorators(
    UseGuards(AuthGuard('jwt'), PermissionsGuard, OwnTenantScopeGuard),
    RequirePermissions(permissions, operator),
    SetMetadata(OWN_TENANT_SCOPE_KEY, options),
  );
}
