import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { excludeTestTenants } from '../util/test-tenant.util';

export interface TokenUsageByModelTaskRow {
  service: string;
  model: string;
  provider: string;
  task: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  audioMs: number;
  characters: number;
  calls: number;
}

/**
 * Read-side aggregation over the `llm_usage` fact table for the super-admin
 * token-consumption chart. Mirrors PlatformAnalyticsRepository: a
 * `DataSource`-backed query builder over the table BY NAME (no entity repo),
 * counts cast to JS numbers, sums cast from bigint and re-parsed defensively.
 * Platform-wide (not tenant-scoped) by design.
 */
@Injectable()
export class LlmUsageRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * AI usage grouped by (service, provider, model, task) within [start, end).
   * Sums each service's billable quantity (LLM tokens, STT audioMs, TTS
   * characters). The frontend pivots these points into a stacked bar; cost is
   * computed in the service from the per-service pricing tables.
   */
  async getTokenUsageByModelAndTask(
    start: Date,
    end: Date,
  ): Promise<TokenUsageByModelTaskRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('lu.service', 'service')
      .addSelect('lu.model', 'model')
      .addSelect('lu.provider', 'provider')
      .addSelect('lu.task', 'task')
      .addSelect('COALESCE(SUM(lu."promptTokens"), 0)::bigint', 'promptTokens')
      .addSelect(
        'COALESCE(SUM(lu."completionTokens"), 0)::bigint',
        'completionTokens',
      )
      .addSelect('COALESCE(SUM(lu."totalTokens"), 0)::bigint', 'totalTokens')
      .addSelect('COALESCE(SUM(lu."cachedTokens"), 0)::bigint', 'cachedTokens')
      .addSelect('COALESCE(SUM(lu."audioMs"), 0)::bigint', 'audioMs')
      .addSelect('COALESCE(SUM(lu."characters"), 0)::bigint', 'characters')
      .addSelect('COUNT(*)::int', 'calls')
      .from('llm_usage', 'lu')
      .where('lu."occurredAt" >= :start', { start })
      .andWhere('lu."occurredAt" < :end', { end })
      // Null-preserving: most llm_usage rows are deliberately tenantless
      // (judges, autofill, translation) and must survive the filter.
      .andWhere(excludeTestTenants('lu."tenant_id"'))
      .groupBy('lu.service')
      .addGroupBy('lu.model')
      .addGroupBy('lu.provider')
      .addGroupBy('lu.task')
      .orderBy('"totalTokens"', 'DESC')
      .getRawMany<{
        service: string;
        model: string;
        provider: string;
        task: string;
        promptTokens: string;
        completionTokens: string;
        totalTokens: string;
        cachedTokens: string;
        audioMs: string;
        characters: string;
        calls: number;
      }>();

    return rows.map((r) => ({
      service: r.service,
      model: r.model,
      provider: r.provider,
      task: r.task,
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      totalTokens: Number(r.totalTokens) || 0,
      cachedTokens: Number(r.cachedTokens) || 0,
      audioMs: Number(r.audioMs) || 0,
      characters: Number(r.characters) || 0,
      calls: Number(r.calls) || 0,
    }));
  }
}
