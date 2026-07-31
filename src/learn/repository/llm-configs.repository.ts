import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LlmConfigs } from '../entity/llm-configs.entity';
import { ProviderConfigRepository } from './provider-config.repository';

@Injectable()
export class LlmConfigsRepository extends ProviderConfigRepository<LlmConfigs> {
  constructor(private dataSource: DataSource) {
    super(LlmConfigs, dataSource.createEntityManager());
  }
}
