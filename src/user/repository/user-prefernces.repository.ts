import { Repository } from 'typeorm/repository/Repository.js';
import { DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { UserPreferences } from '../entity/user-preferences.entity';

@Injectable()
export class UserPreferencesRepository extends Repository<UserPreferences> {
  constructor(private dataSource: DataSource) {
    super(UserPreferences, dataSource.createEntityManager());
  }

  async getUserPreferencesByUserId(userId: number) {
    return this.createQueryBuilder('up')
      .select('up.data')
      .where('up."userId" = :userId', { userId })
      .getOne();
  }

  async upsertUserPreferences(
    userId: number,
    tenantId: string,
    incoming: Record<string, any>,
  ) {
    let preferences = await this.findOne({ where: { userId } });

    if (preferences) {
      preferences.data = { ...preferences.data, ...incoming };
    } else {
      preferences = this.create({
        userId,
        tenantId,
        data: incoming,
      });
    }

    return await this.save(preferences);
  }
}
