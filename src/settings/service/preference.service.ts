import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { PreferenceName } from '../../common/constants/user.constants';
import { Preference } from '../entity/preference.entity';
import { PreferenceValue } from '../../common/type/common.type';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { PreferenceRepository } from '../repository/preference.repository';

@Injectable()
export class PreferenceService {
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private readonly preferenceRepository: PreferenceRepository,
    private readonly preferenceCache: RedisService,
  ) {}

  private readonly logger = LoggerService.getInstance(PreferenceService.name);

  async createPreference(preference: Partial<Preference>): Promise<Preference> {
    return this.preferenceRepository.createPreference(preference);
  }

  async getPreference(
    name: PreferenceName,
    relatedId: string,
    relatedEntity: string,
  ): Promise<Preference | null> {
    const cacheKey = `preference:${name}:${relatedId}:${relatedEntity}`;
    const cachedPreference = await this.preferenceCache.get(cacheKey);
    if (cachedPreference) {
      return JSON.parse(cachedPreference);
    }
    const preference = await this.preferenceRepository.findPreference(
      name,
      relatedId,
      relatedEntity,
    );
    if (preference) {
      await this.preferenceCache.set(cacheKey, JSON.stringify(preference));
    }
    return preference;
  }

  async updatePreference(
    id: string,
    value: PreferenceValue,
  ): Promise<Preference | null> {
    await this.preferenceRepository.updatePreference(id, value);
    const updatePreference =
      await this.preferenceRepository.findPreferenceById(id);
    if (updatePreference) {
      const cacheKey = `preference:${updatePreference.name}:${updatePreference.relatedId}:${updatePreference.relatedEntity}`;
      await this.preferenceCache.set(
        cacheKey,
        JSON.stringify(updatePreference),
      );
    }
    return updatePreference;
  }

  async deletePreference(id: string): Promise<Preference | null> {
    const preference = await this.preferenceRepository.findPreferenceById(id);
    if (preference) {
      await this.preferenceRepository.deletePreference(id);
      const cacheKey = `preference:${preference.name}:${preference.relatedId}:${preference.relatedEntity}`;
      try {
        await this.preferenceCache.del(cacheKey);
      } catch (error) {
        // Log cache deletion error but don't fail the operation
        this.logger.error('Failed to delete cache entry:', error);
      }
    }
    return preference;
  }
}
