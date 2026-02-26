import { Repository, DataSource } from 'typeorm';
import { GlobalSettings } from '../entity/global-settings.entity';
import { Injectable } from '@nestjs/common';
@Injectable()
export class GlobalSettingsRepository extends Repository<GlobalSettings> {
  constructor(private dataSource: DataSource) {
    super(GlobalSettings, dataSource.createEntityManager());
  }
}
