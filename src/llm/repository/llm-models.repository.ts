import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LlmModels } from '../entity/llm-models.entity';

@Injectable()
export class LlmModelsRepository extends Repository<LlmModels> {
  constructor(private dataSource: DataSource) {
    super(LlmModels, dataSource.createEntityManager());
  }

  /** Catalog rows, active first, in a stable display order. */
  async listModels(activeOnly = false): Promise<LlmModels[]> {
    return this.find({
      ...(activeOnly ? { where: { active: true } } : {}),
      order: { provider: 'ASC', label: 'ASC' },
    });
  }
}
