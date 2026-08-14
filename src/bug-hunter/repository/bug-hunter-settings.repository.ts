import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';
import { BugHunterMode } from '../enum/bug-finding.enum';

const SINGLETON_ID = 1;

@Injectable()
export class BugHunterSettingsRepository extends Repository<BugHunterSettings> {
  constructor(dataSource: DataSource) {
    super(BugHunterSettings, dataSource.createEntityManager());
  }

  /** The one row, seeded `mode=off` by the introducing migration. */
  getSettings(): Promise<BugHunterSettings> {
    return this.findOneOrFail({ where: { id: SINGLETON_ID } });
  }

  async setMode(
    mode: BugHunterMode,
    updatedBy: number,
  ): Promise<BugHunterSettings> {
    await this.update(SINGLETON_ID, { mode, updatedBy });
    return this.getSettings();
  }
}
