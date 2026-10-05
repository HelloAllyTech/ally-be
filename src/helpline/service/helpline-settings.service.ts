import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import {
  PreferenceName,
  PreferenceRelatedEntity,
} from 'src/common/constants/user.constants';
import { RedisService } from 'src/redis/service/redis.service';
import { Preference } from 'src/settings/entity/preference.entity';
import { PreferenceValue } from 'src/common/type/common.type';
import { LoggerService } from 'src/logger/logger.service';
import { HELPLINE_TIMINGS } from '../constants/helpline.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../constants/helpline-settings.defaults';
import {
  AdminSettingsDto,
  HelplineSettings,
  HelplineTenant,
  ListenerSettingsDto,
} from '../type/helpline.types';
import { badRequest } from '../util/helpline-errors';
import {
  applyHelplineSettingsPatch,
  mergeHelplineSettings,
  validateHelplineSettingsPatch,
} from '../util/helpline-settings-validation';

/**
 * The two org preference rows (contract §8): `TEXT_HELPLINE_ENABLED`
 * (`{ enabled }`) and `TEXT_HELPLINE_SETTINGS` (a partial settings object).
 *
 * Kept in the helpline module rather than SettingsService so nothing here
 * pulls the settings module into a guard's dependency graph. Writes mirror
 * SettingsService.updateCharacterLibraryEnabled (find, then update or insert,
 * keyed by tenant code) and also bust PreferenceService's cache key so any
 * reader going through it sees the change.
 *
 * The enabled flag is read through TenantFeatureService — the same raw read
 * the guard uses — so a flip takes effect on the next request everywhere.
 */
@Injectable()
export class HelplineSettingsService {
  private readonly logger = LoggerService.getInstance(
    HelplineSettingsService.name,
  );
  private readonly cache = new Map<
    string,
    { value: HelplineSettings; expires: number }
  >();

  constructor(
    @InjectRepository(Preference)
    private readonly preferences: Repository<Preference>,
    private readonly tenantFeatureService: TenantFeatureService,
    private readonly redisService: RedisService,
  ) {}

  get defaults(): HelplineSettings {
    return structuredClone(HELPLINE_DEFAULT_SETTINGS);
  }

  isEnabled(tenant: HelplineTenant): Promise<boolean> {
    return this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      tenant.code,
    );
  }

  async getSettings(tenant: HelplineTenant): Promise<HelplineSettings> {
    const cached = this.cache.get(tenant.id);
    if (cached && cached.expires > Date.now()) return cached.value;
    const stored = await this.readStored(tenant);
    const value = mergeHelplineSettings(HELPLINE_DEFAULT_SETTINGS, stored);
    this.cache.set(tenant.id, {
      value,
      expires: Date.now() + HELPLINE_TIMINGS.SETTINGS_CACHE_MS,
    });
    return value;
  }

  toListenerSettings(settings: HelplineSettings): ListenerSettingsDto {
    return {
      escalationChecklist: settings.escalationChecklist,
      listenerSupportContact: settings.listenerSupportContact,
      summaryFields: settings.summaryFields,
      copilot: {
        suggestions: settings.copilot.suggestions,
        nudges: settings.copilot.nudges,
        riskClassifier: settings.copilot.riskClassifier,
      },
      languages: settings.languages,
      idleEndMinutes: settings.idleEndMinutes,
    };
  }

  async getAdminSettings(tenant: HelplineTenant): Promise<AdminSettingsDto> {
    const [enabled, settings] = await Promise.all([
      this.isEnabled(tenant),
      this.getSettings(tenant),
    ]);
    return {
      tenantId: tenant.id,
      tenantCode: tenant.code,
      enabled,
      settings,
      defaults: this.defaults,
      publicPath: `/talk/${tenant.code}`,
    };
  }

  /**
   * Validates the whole patch before writing anything, so a bad field never
   * leaves the enabled flag flipped and the settings unsaved.
   */
  async updateAdminSettings(
    tenant: HelplineTenant,
    update: { enabled?: boolean; settings?: unknown },
  ): Promise<AdminSettingsDto> {
    const { value, errors } = validateHelplineSettingsPatch(update.settings);
    if (errors.length) {
      throw badRequest(`Invalid helpline settings: ${errors.join('; ')}`);
    }

    if (update.settings != null) {
      const stored = await this.readStored(tenant);
      const next = applyHelplineSettingsPatch(stored, value);
      await this.upsert(PreferenceName.TEXT_HELPLINE_SETTINGS, tenant, next);
    }
    if (typeof update.enabled === 'boolean') {
      await this.upsert(PreferenceName.TEXT_HELPLINE_ENABLED, tenant, {
        enabled: update.enabled,
      });
    }
    this.cache.delete(tenant.id);
    this.logger.info(
      `Helpline settings updated for tenant ${tenant.id}` +
        (typeof update.enabled === 'boolean'
          ? ` (enabled=${update.enabled})`
          : ''),
    );
    return this.getAdminSettings(tenant);
  }

  /** Drop this replica's memo (e.g. after a write elsewhere is known). */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  private async readStored(
    tenant: HelplineTenant,
  ): Promise<Partial<HelplineSettings> | null> {
    const row = await this.preferences.findOne({
      where: {
        name: PreferenceName.TEXT_HELPLINE_SETTINGS,
        relatedId: tenant.code,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      },
    });
    const value = row?.value as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<HelplineSettings>)
      : null;
  }

  private async upsert(
    name: PreferenceName,
    tenant: HelplineTenant,
    value: unknown,
  ): Promise<void> {
    const existing = await this.preferences.findOne({
      where: {
        name,
        relatedId: tenant.code,
        relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
      },
    });
    if (existing) {
      await this.preferences.update(existing.id, {
        value: value as PreferenceValue,
      });
    } else {
      await this.preferences.save(
        this.preferences.create({
          name,
          relatedId: tenant.code,
          relatedEntity: PreferenceRelatedEntity.ORGANIZATION,
          value: value as PreferenceValue,
          tenantId: tenant.code,
        }),
      );
    }
    // PreferenceService caches by this key with no TTL; drop it so a reader
    // going through that service does not serve the old value forever.
    try {
      await this.redisService.del(
        `preference:${name}:${tenant.code}:${PreferenceRelatedEntity.ORGANIZATION}`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not bust the preference cache for ${name}: ${(error as Error).message}`,
      );
    }
  }
}
