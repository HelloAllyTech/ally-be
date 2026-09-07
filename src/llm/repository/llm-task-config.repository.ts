import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LlmTaskConfig } from '../entity/llm-task-config.entity';

@Injectable()
export class LlmTaskConfigRepository extends Repository<LlmTaskConfig> {
  constructor(private dataSource: DataSource) {
    super(LlmTaskConfig, dataSource.createEntityManager());
  }

  /**
   * Every per-task selection, keyed by registry row id.
   *
   * The whole table in one query rather than a lookup per task: it holds at
   * most one row per AI task (71 today), and the resolver is called on request
   * paths where a second round-trip to Postgres costs more than fetching rows
   * nobody asked for. The caller caches this.
   */
  async findAllByTaskId(): Promise<Map<string, LlmTaskConfig>> {
    const rows = await this.find();
    return new Map(rows.map((row) => [row.taskId, row]));
  }

  async findByTaskId(taskId: string): Promise<LlmTaskConfig | null> {
    return this.findOne({ where: { taskId } });
  }
}
