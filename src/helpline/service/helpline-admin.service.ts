import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  AdminSettingsDto,
  HelplineStaffUser,
  HelplineTenant,
} from '../type/helpline.types';
import { helplineError } from '../util/helpline-errors';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

const tenantNotFound = () => new NotFoundException('Organisation not found');

/**
 * Admin console → Organization → Text helpline (contract §5.4).
 *
 * Tenant scoping follows SettingsService.resolveWritableTenantId: a caller
 * with SYSTEM_ACCESS may name any tenant (defaulting to their own); anyone
 * else gets their own tenant and is refused if they name another. A platform
 * admin restricted to some tenants (`admin_tenants` rows) is held to those.
 */
@Injectable()
export class HelplineAdminService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: PermissionsService,
    private readonly tenants: HelplineTenantService,
    private readonly settings: HelplineSettingsService,
  ) {}

  async getSettings(
    user: HelplineStaffUser,
    requestedTenant?: string,
  ): Promise<AdminSettingsDto> {
    const tenant = await this.resolveTenant(user, requestedTenant);
    return this.settings.getAdminSettings(tenant);
  }

  async updateSettings(
    user: HelplineStaffUser,
    body: { tenantId: string; enabled?: boolean; settings?: unknown },
  ): Promise<AdminSettingsDto> {
    const tenant = await this.resolveTenant(user, body.tenantId);
    return this.settings.updateAdminSettings(tenant, {
      enabled: body.enabled,
      settings: body.settings,
    });
  }

  async resolveTenant(
    user: HelplineStaffUser,
    requested?: string,
  ): Promise<HelplineTenant> {
    const userPermissions = await this.permissions.getUserPermissions(user.id);
    const systemAccess = userPermissions.includes(PERMISSIONS.SYSTEM_ACCESS);
    const own = await this.tenants.resolve(user.tenantId);

    if (!systemAccess) {
      if (!own) throw tenantNotFound();
      if (requested) {
        const named = await this.tenants.resolve(requested);
        if (!named || named.id !== own.id) {
          throw helplineError(
            HttpStatus.FORBIDDEN,
            ErrorCode.PERMISSION_DENIED,
            'You can only manage your own organisation',
          );
        }
      }
      return own;
    }

    const tenant = requested ? await this.tenants.resolve(requested) : own;
    if (!tenant) throw tenantNotFound();
    if (await this.permissions.isMultiTenantAdmin(user.id)) {
      const rows: { tenantId: string }[] = await this.dataSource.query(
        `SELECT "tenantId" FROM admin_tenants WHERE "userId" = $1 AND "deletedAt" IS NULL`,
        [user.id],
      );
      if (!rows.some((row) => String(row.tenantId) === tenant.id)) {
        throw tenantNotFound();
      }
    }
    return tenant;
  }
}
