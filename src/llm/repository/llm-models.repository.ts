import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { LlmModels } from '../entity/llm-models.entity';

@Injectable()
export class LlmModelsRepository extends Repository<LlmModels> {
  constructor(private dataSource: DataSource) {
    super(LlmModels, dataSource.createEntityManager());
  }

  /**
   * Rows by id, keyed for the session resolver.
   *
   * Mirrors ProviderConfigRepository.findMapByIds so every rung of the
   * resolution chain is looked up the same way. Empty input short-circuits —
   * a language with no catalog model must not trigger a query.
   */
  async findMapByIds(ids: string[]): Promise<Map<string, LlmModels>> {
    if (!ids.length) return new Map();
    const rows = await this.find({ where: { id: In(ids) } });
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Catalog rows, active first, in a stable display order. */
  async listModels(activeOnly = false): Promise<LlmModels[]> {
    return this.find({
      ...(activeOnly ? { where: { active: true } } : {}),
      order: { provider: 'ASC', label: 'ASC' },
    });
  }
}
