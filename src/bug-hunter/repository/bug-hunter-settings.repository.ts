import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';

const SINGLETON_ID = 1;

@Injectable()
export class BugHunterSettingsRepository extends Repository<BugHunterSettings> {
  constructor(dataSource: DataSource) {
    super(BugHunterSettings, dataSource.createEntityManager());
  }

  /** The one row, seeded `enabled=false` by the introducing migration. */
  getSettings(): Promise<BugHunterSettings> {
    return this.findOneOrFail({ where: { id: SINGLETON_ID } });
  }

  async setEnabled(
    enabled: boolean,
    updatedBy: number,
  ): Promise<BugHunterSettings> {
    await this.update(SINGLETON_ID, { enabled, updatedBy });
    return this.getSettings();
  }
}
