import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantScopeService } from 'src/authorization/service/tenant-scope.service';
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
 *  1. Resolve the tenants the caller may reach (TenantScopeService — the
 *     same answer every other tenant-scoped surface uses).
 *  2. An unrestricted platform admin (SYSTEM_ACCESS, no `admin_tenants`
 *     rows) may target any tenant.
 *  3. Everyone else — a plain tenant ADMIN (scope = their JWT tenant) or a
 *     platform admin restricted to an allowlist (scope = those tenants):
 *     resolve the TARGET tenant ids from the request (route param
 *     `tenantId`, body `tenantId`, and the body `tenantIds` array used by
 *     the badge endpoints) and require that there is at least one and that
 *     EVERY one is inside the scope. Any miss → ForbiddenException.
 *
 * Step 3 used to apply to tenant ADMINs only: any SYSTEM_ACCESS holder was
 * waved through, so an allowlisted platform admin could assign content to,
 * and edit the cohorts of, every organisation on the platform.
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
    private readonly tenantScopeService: TenantScopeService,
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

    const scope = await this.tenantScopeService.resolveScope(Number(user.id));
    if (scope.tenantIds === null) {
      return true;
    }

    if (!scope.restricted && scope.tenantIds.length === 0) {
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

    const allowed = scope.tenantIds;
    if (!targetTenantIds.every((tenantId) => allowed.includes(tenantId))) {
      throw new ForbiddenException(
        scope.restricted
          ? 'You can only manage the organizations assigned to you'
          : 'You can only manage access for your own tenant',
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
