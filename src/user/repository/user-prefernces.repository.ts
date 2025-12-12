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

  async upsertUserPreferences(userId: number, incoming: Record<string, any>) {
    const jsonStr = JSON.stringify(incoming);

    const result = await this.createQueryBuilder()
      .insert()
      .into(UserPreferences)
      .values({
        // use parameter binding for scalar value
        userId: () => ':userId',
        // cast parameter to jsonb
        data: () => 'CAST(:data AS jsonb)',
        createdAt: () => 'now()',
        updatedAt: () => 'now()',
      })
      .onConflict(
        // quote camelCase column names so Postgres doesn't lowercase them
        `("userId") DO UPDATE 
         SET "data" = "user_preferences"."data" || excluded."data",
             "updatedAt" = now()`,
      )
      .returning(['id', 'userId', 'data', 'createdAt', 'updatedAt'])
      .setParameters({ userId, data: jsonStr })
      .execute();

    return result;
  }
}
