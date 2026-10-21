import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { PermissionsService } from './permissions.service';
import { PERMISSIONS } from '../constants/permissions.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { AdminTenant } from 'src/user/entity/admin-tenant.entity';
import { Tenant } from 'src/tenant/entity/tenant.entity';

/**
 * The organisations a caller may act on.
 *
 * `tenantIds: null` means unrestricted (platform-wide). `restricted` is true
 * only for a platform admin confined to an `admin_tenants` allowlist — callers
 * use it to word a refusal, and to refuse platform-wide surfaces outright.
 */
export interface TenantScope {
  tenantIds: string[] | null;
  restricted: boolean;
}

const OUT_OF_SCOPE_MESSAGE = 'You do not have access to this organization';

/**
 * The refusal for something that spans every organization — a platform-only
 * feature toggle, a @PlatformWidePermissions route. Names the way out, since
 * the admin can do nothing about it themselves.
 */
export const PLATFORM_WIDE_ONLY_MESSAGE =
  'This is only available to admins with access to every organization. ' +
  'Ask whoever manages admin access to lift your organization restriction.';

/**
 * TenantScopeService
 * ------------------
 * The one answer to "which organisations can this caller reach", so a
 * tenant-restricted platform admin is held to their allowlist everywhere a
 * tenant id is taken from the request — not only in the handful of services
 * that used to look the allowlist up for themselves.
 *
 * Three cases, in this order:
 *   1. A platform admin with any live `admin_tenants` row → those tenants.
 *      Checked first because every platform admin also holds SYSTEM_ACCESS.
 *      Tenants deleted since they were granted drop out, so the list can be
 *      empty — which reaches nothing, never everything.
 *   2. SYSTEM_ACCESS → unrestricted.
 *   3. Anyone else → their own JWT tenant (or nothing without one).
 *
 * Lives in AuthorizationModule and reads `admin_tenants` through a plain
 * repository rather than AdminTenantService — importing src/user/service/*
 * here breaks the app at boot (see PermissionsService's constructor).
 */
@Injectable()
export class TenantScopeService {
  constructor(
    private readonly permissionsService: PermissionsService,
    @InjectRepository(AdminTenant)
    private readonly adminTenantRepository: Repository<AdminTenant>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  /** True for a platform admin confined to an `admin_tenants` allowlist. */
  async isRestricted(userId = currentUserId()): Promise<boolean> {
    if (!userId) return false;
    return this.permissionsService.isMultiTenantAdmin(userId);
  }

  async resolveScope(userId = currentUserId()): Promise<TenantScope> {
    if (userId) {
      if (await this.isRestricted(userId)) {
        return {
          tenantIds: await this.allowlistedTenantIds(userId),
          restricted: true,
        };
      }

      const permissions =
        await this.permissionsService.getUserPermissions(userId);
      if (permissions.includes(PERMISSIONS.SYSTEM_ACCESS)) {
        return { tenantIds: null, restricted: false };
      }
    }

    const ownTenantId = ExecutionManager.getTenantId();
    return { tenantIds: ownTenantId ? [ownTenantId] : [], restricted: false };
  }

  /** The tenant ids the caller may act on; `null` means unrestricted. */
  async resolveTenantIds(userId = currentUserId()): Promise<string[] | null> {
    return (await this.resolveScope(userId)).tenantIds;
  }

  /**
   * Refuse a tenant the caller cannot reach. Accepts a tenant id or a tenant
   * code, because several endpoints (settings, analytics) take either.
   *
   * Forbidden rather than not-found: the caller named the tenant, and the
   * refusal is the same whether or not it exists, so nothing leaks.
   */
  async assertTenantInScope(
    tenantIdOrCode: string,
    options: { userId?: number; message?: string } = {},
  ): Promise<void> {
    const { tenantIds } = await this.resolveScope(
      options.userId ?? currentUserId(),
    );
    if (tenantIds === null || tenantIds.includes(tenantIdOrCode)) {
      return;
    }

    const byCode = await this.tenantRepository.findOne({
      where: { code: tenantIdOrCode },
      select: ['id'],
    });
    if (byCode && tenantIds.includes(byCode.id)) {
      return;
    }

    throw new ForbiddenException(options.message ?? OUT_OF_SCOPE_MESSAGE);
  }

  private async allowlistedTenantIds(userId: number): Promise<string[]> {
    const rows = await this.adminTenantRepository.find({
      where: { userId, deletedAt: IsNull() },
      select: ['tenantId'],
    });
    if (rows.length === 0) return [];

    // A soft-deleted tenant is excluded by find() itself.
    const live = await this.tenantRepository.find({
      where: { id: In(rows.map((row) => row.tenantId)) },
      select: ['id'],
    });
    return live.map((tenant) => tenant.id);
  }
}

function currentUserId(): number | undefined {
  const userId = ExecutionManager.getUserId();
  return userId ? Number(userId) : undefined;
}
