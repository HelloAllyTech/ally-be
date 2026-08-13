import { BadRequestException, Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/service/redis.service';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { AUDIT_EVENTS } from 'src/audit/constants/audit-event.constants';
import { AdminFeatureToggleRepository } from '../repository/admin-feature-toggle.repository';
import {
  FEATURE_TOGGLES,
  FeatureToggleKey,
  isValidFeatureToggleKey,
} from '../constants/admin-feature-toggle.constants';

const CACHE_TTL_SECONDS = 1800; // 30 min — matches user:roles/user:groups/group:permissions,
// so a toggle row written outside this service (e.g. the role-collapse
// migration's raw SQL backfill) self-heals instead of being masked forever.

/**
 * Per-admin-user feature toggles — the additional, per-user narrowing layer
 * that sits on top of PLATFORM_ADMIN's group-level permission grant.
 * FeatureToggleGuard is the only caller that needs `hasToggle`; the CRUD
 * methods back the admin-user-management editor endpoints.
 *
 * Fails closed by design: a missing row means disabled, never enabled. This
 * is the only thing standing between "any platform admin" and "a platform
 * admin with this specific formerly-SDA-only capability" now that role-name
 * gates are gone.
 */
@Injectable()
export class FeatureToggleService {
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly toggleRepository: AdminFeatureToggleRepository,
    private readonly cache: RedisService,
  ) {}

  private cacheKey(userId: number): string {
    return `admin:feature-toggles:${userId}`;
  }

  async getEnabledKeys(userId: number): Promise<string[]> {
    const cached = await this.cache.get(this.cacheKey(userId));
    if (cached) {
      return JSON.parse(cached);
    }

    const rows = await this.toggleRepository.findByUserId(userId);
    const enabledKeys = rows
      .filter((row) => row.enabled)
      .map((row) => row.featureKey);

    await this.cache.set(
      this.cacheKey(userId),
      JSON.stringify(enabledKeys),
      CACHE_TTL_SECONDS,
    );
    return enabledKeys;
  }

  async hasToggle(userId: number, featureKey: string): Promise<boolean> {
    const enabledKeys = await this.getEnabledKeys(userId);
    return enabledKeys.includes(featureKey);
  }

  /** Toggle state for every registered key, defaulting missing rows to false — for the editor UI. */
  async getTogglesForUser(userId: number): Promise<
    {
      key: FeatureToggleKey;
      label: string;
      description: string;
      enabled: boolean;
    }[]
  > {
    const rows = await this.toggleRepository.findByUserId(userId);
    const enabledByKey = new Map(
      rows.map((row) => [row.featureKey, row.enabled]),
    );

    return FEATURE_TOGGLES.map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      enabled: enabledByKey.get(definition.key) ?? false,
    }));
  }

  async countEnabledHolders(featureKey: string): Promise<number> {
    const rows = await this.toggleRepository.findEnabledUserIds(featureKey);
    return rows.length;
  }

  /**
   * Upserts a batch of toggles for one user. Rejects unknown keys — narrowing
   * an enum is always safe, unlike the "never tighten a value a client sends
   * verbatim" gotcha, since nothing external depends on being able to set an
   * undeclared feature key.
   */
  async setToggles(
    userId: number,
    toggles: { featureKey: string; enabled: boolean }[],
    actingUserId: number,
  ): Promise<void> {
    for (const { featureKey } of toggles) {
      if (!isValidFeatureToggleKey(featureKey)) {
        throw new BadRequestException(
          `Unknown feature toggle key: ${featureKey}`,
        );
      }
    }

    const disablingAdminUserManagement = toggles.some(
      (t) =>
        t.featureKey === FeatureToggleKey.ADMIN_USER_MANAGEMENT && !t.enabled,
    );
    if (disablingAdminUserManagement) {
      if (userId === actingUserId) {
        throw new BadRequestException(
          'You cannot disable your own Admin User Management access',
        );
      }
      const currentHolders = await this.countEnabledHolders(
        FeatureToggleKey.ADMIN_USER_MANAGEMENT,
      );
      const targetAlreadyHasIt = await this.hasToggle(
        userId,
        FeatureToggleKey.ADMIN_USER_MANAGEMENT,
      );
      if (targetAlreadyHasIt && currentHolders <= 1) {
        throw new BadRequestException(
          'Cannot remove the last remaining Admin User Management holder',
        );
      }
    }

    for (const { featureKey, enabled } of toggles) {
      await this.toggleRepository.upsertToggle(
        userId,
        featureKey,
        enabled,
        actingUserId,
      );
    }
    await this.cache.del(this.cacheKey(userId));

    await this.auditLogger.log({
      eventType: AUDIT_EVENTS.ADMIN_FEATURE_TOGGLES_UPDATED,
      userId: actingUserId,
      details: { targetUserId: userId, toggles },
    });
  }
}
