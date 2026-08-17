import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from 'src/common/constants/user.constants';

/**
 * Reads org-level (per-tenant) boolean feature preferences.
 *
 * Deliberately a thin DataSource query rather than an injection of
 * SettingsService/PreferenceService: this is consumed by FeatureToggleGuard,
 * which lives in the @Global AuthModule, and pulling a settings-module provider
 * into a global guard is exactly the import cycle that breaks Nest boot.
 * Reading straight from the table also means a freshly-flipped toggle takes
 * effect immediately instead of waiting out the preference cache.
 */
@Injectable()
export class TenantFeatureService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * True only when a preference row exists for this tenant with
   * `value.enabled === true`. A missing row is OFF — org toggles fail closed,
   * so a feature is never live for a tenant nobody switched it on for.
   */
  async isEnabledForTenant(
    name: PreferenceName,
    tenantId: string | undefined,
  ): Promise<boolean> {
    if (!tenantId) return false;

    const tenantCode = await this.resolveTenantCode(tenantId);
    const rows: { value: { enabled?: boolean } | null }[] =
      await this.dataSource.query(
        `SELECT "value" FROM "preference"
         WHERE "name" = $1 AND "relatedId" = $2 AND "relatedEntity" = $3
         LIMIT 1`,
        [name, tenantCode, PreferenceRelatedEntity.ORGANIZATION],
      );

    return rows?.[0]?.value?.enabled === true;
  }

  /**
   * Org preferences are keyed by tenant *code*, but a JWT may carry the tenant
   * uuid — mirrors SettingsService.resolveTenantCode so both paths address the
   * same row.
   */
  private async resolveTenantCode(tenantId: string): Promise<string> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        tenantId,
      );
    if (!isUuid) return tenantId;
    const row = await this.dataSource.query(
      `SELECT code FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return row?.[0]?.code ?? tenantId;
  }
}
