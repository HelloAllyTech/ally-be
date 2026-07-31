import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SttConfigs } from '../entity/stt-configs.entity';
import { ProviderConfigRepository } from './provider-config.repository';

@Injectable()
export class SttConfigsRepository extends ProviderConfigRepository<SttConfigs> {
  constructor(private dataSource: DataSource) {
    super(SttConfigs, dataSource.createEntityManager());
  }
}
