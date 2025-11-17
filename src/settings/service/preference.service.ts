import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { PreferenceName } from '../../common/constants/user.constants';
import { Preference } from '../entity/preference.entity';
import { PreferenceValue } from '../../common/type/common.type';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';

@Injectable()
export class PreferenceService {
  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    @InjectRepository(Preference)
    private readonly preferenceRepository: Repository<Preference>,
    private readonly preferenceCache: RedisService,
  ) {}

  private readonly logger = LoggerService.getInstance(PreferenceService.name);

  async createPreference(preference: Partial<Preference>): Promise<Preference> {
    return this.preferenceRepository.save(preference);
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
    const preference = await this.preferenceRepository.findOne({
      where: { name, relatedId, relatedEntity },
    });
    if (preference) {
      await this.preferenceCache.set(cacheKey, JSON.stringify(preference));
    }
    return preference;
  }

  async updatePreference(
    id: string,
    value: PreferenceValue,
  ): Promise<Preference | null> {
    await this.preferenceRepository.update(id, {
      value,
    });
    const updatePreference = await this.preferenceRepository.findOne({
      where: { id },
    });
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
    const preference = await this.preferenceRepository.findOne({
      where: { id },
    });
    if (preference) {
      await this.preferenceRepository.delete(id);
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
