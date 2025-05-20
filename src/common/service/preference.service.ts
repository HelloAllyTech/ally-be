import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Preference } from '../entities/preference.entity';
import { Repository } from 'typeorm';
import { RedisService } from '../../redis/service/redis.service';

@Injectable()
export class PreferenceService {
  constructor(
    @InjectRepository(Preference)
    private readonly preferenceRepository: Repository<Preference>,
    private readonly preferenceCache: RedisService,
  ) {}

  async createPreference(preference: Preference): Promise<Preference> {
    return this.preferenceRepository.save(preference);
  }

  async getPreference(
    relatedId: string,
    relatedEntity: string,
  ): Promise<Preference | null> {
    const cacheKey = `preference:${relatedId}:${relatedEntity}`;
    const cachedPreference = await this.preferenceCache.get(cacheKey);
    if (cachedPreference) {
      return JSON.parse(cachedPreference);
    }
    const preference = await this.preferenceRepository.findOne({
      where: { relatedId, relatedEntity },
    });
    if (preference) {
      await this.preferenceCache.set(cacheKey, JSON.stringify(preference));
    }
    return preference;
  }

  async updatePreference(preference: Preference): Promise<Preference> {
    const updatedPreference = await this.preferenceRepository.save(preference);
    const cacheKey = `preference:${preference.relatedId}:${preference.relatedEntity}`;
    await this.preferenceCache.set(cacheKey, JSON.stringify(updatedPreference));
    return updatedPreference;
  }

  async deletePreference(preference: Preference): Promise<void> {
    await this.preferenceRepository.delete(preference.id);
    const cacheKey = `preference:${preference.relatedId}:${preference.relatedEntity}`;
    await this.preferenceCache.del(cacheKey);
  }
}
