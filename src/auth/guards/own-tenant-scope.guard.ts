import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import {
  OWN_TENANT_SCOPE_KEY,
  OwnTenantScopeOptions,
} from '../decorators/own-tenant-scope.decorator';

/**
 * OwnTenantScopeGuard
 * -------------------
 * Security-critical guard that lets tenant-level ADMINs call
 * tenant-scoped content-access endpoints (assign/unassign scenarios,
 * scenario-paths, cases, badges to a tenant, and read a tenant's
 * assignments) while GUARANTEEING they can only ever target their OWN
 * tenant — the tenant baked into their JWT.
 *
 * How it works, per request:
 *  1. Resolve the caller's effective permissions (same source the
 *     PermissionsGuard uses).
 *  2. If the caller has SYSTEM_ACCESS (SUPER_ADMIN / MULTI_TENANT_ADMIN),
 *     allow unconditionally — their existing cross-tenant behaviour is
 *     preserved exactly.
 *  3. Otherwise (a plain tenant ADMIN): resolve the TARGET tenant id from
 *     the request (route param `tenantId`, else body `tenantId`, else the
 *     body `tenantIds` array used by the badge endpoints) and require that
 *     EVERY target tenant id is present AND strictly equals the caller's
 *     own tenant id (ExecutionManager.getTenantId()). Any mismatch,
 *     missing id, or missing caller tenant → ForbiddenException.
 *
 * This is what makes it safe to grant the tenant-assignment permissions
 * (EDIT_/DELETE_*_TENANT etc.) to the ADMIN role: the permission opens the
 * door, this guard nails it to the caller's own tenant.
 *
 * Compose it AFTER @AuthPermissions (which runs AuthGuard('jwt') +
 * PermissionsGuard so `request.user` and the JWT tenant context exist).
 */
@Injectable()
export class OwnTenantScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options =
      this.reflector.getAllAndOverride<OwnTenantScopeOptions>(
        OWN_TENANT_SCOPE_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? {};

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // No authenticated user → nothing to scope; deny (JWT guard should have
    // already rejected, this is defence-in-depth).
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // 1. Super admin / multi-tenant admin keep their existing cross-tenant
    //    behaviour untouched.
    const userPermissions = await this.permissionsService.getUserPermissions(
      user.id,
    );
    if (userPermissions.includes(PERMISSIONS.SYSTEM_ACCESS)) {
      return true;
    }

    // 2. Plain tenant admin: lock every targeted tenant to their own JWT tenant.
    const callerTenantId = ExecutionManager.getTenantId();
    if (!callerTenantId) {
      // Without a tenant in the JWT there is nothing safe to scope to.
      throw new ForbiddenException(
        'No tenant context found for the current user',
      );
    }

    const targetTenantIds = this.resolveTargetTenantIds(request, options);

    if (targetTenantIds.length === 0) {
      // The caller must explicitly name the tenant they are acting on.
      throw new BadRequestException('A target tenant id is required');
    }

    // Every targeted tenant must be exactly the caller's own tenant.
    const allOwnTenant = targetTenantIds.every(
      (tenantId) => tenantId != null && tenantId === callerTenantId,
    );
    if (!allOwnTenant) {
      throw new ForbiddenException(
        'You can only manage access for your own tenant',
      );
    }

    return true;
  }

  /**
   * Collect every tenant id the request is trying to act on. We look at
   * (in order): the route param, a single body `tenantId`, and the body
   * `tenantIds` array (badge endpoints). All discovered ids are returned so
   * the caller-side check can require that ALL of them are the own tenant.
   */
  private resolveTargetTenantIds(
    request: {
      params?: Record<string, unknown>;
      body?: Record<string, unknown>;
    },
    options: OwnTenantScopeOptions,
  ): string[] {
    const paramName = options.paramName ?? 'tenantId';
    const bodyParamName = options.bodyParamName ?? 'tenantId';
    const bodyArrayName = options.bodyArrayName ?? 'tenantIds';

    const ids: string[] = [];

    const paramValue = request.params?.[paramName];
    if (typeof paramValue === 'string' && paramValue.length > 0) {
      ids.push(paramValue);
    }

    const bodyValue = request.body?.[bodyParamName];
    if (typeof bodyValue === 'string' && bodyValue.length > 0) {
      ids.push(bodyValue);
    }

    const bodyArray = request.body?.[bodyArrayName];
    if (Array.isArray(bodyArray)) {
      for (const value of bodyArray) {
        if (typeof value === 'string' && value.length > 0) {
          ids.push(value);
        }
      }
    }

    return ids;
  }
}
