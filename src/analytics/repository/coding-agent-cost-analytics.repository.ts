import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { AnalyticsBucket } from './platform-analytics.repository';
import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/**
 * Which autonomous coding agent an AI call belongs to.
 *
 * Not `llm_usage.service` — every Bug Hunter and Builder call omits `service`
 * (it defaults to `'llm'`), so the two are indistinguishable by that column.
 * `task` is the real discriminator.
 */
export const CODING_AGENTS = ['bug-hunter', 'builder'] as const;
export type CodingAgent = (typeof CODING_AGENTS)[number];

/** Admin-facing names, in the order they are shown. */
export const CODING_AGENT_LABELS: Record<CodingAgent, string> = {
  'bug-hunter': 'Bug Hunter',
  builder: 'Builder',
};

/**
 * Task → agent. Explicit, same style as `TASK_AREA` in
 * `roleplay-cost-analytics.repository.ts` — not a `builder_` prefix check on
 * the raw string, so a future unrelated task cannot join this chart by
 * accident just because someone reused the prefix.
 */
export const TASK_AGENT: Partial<Record<LlmTask, CodingAgent>> = {
  [LlmTask.BUG_HUNTER]: 'bug-hunter',
  [LlmTask.BUILDER_INTERVIEW]: 'builder',
  [LlmTask.BUILDER_BUILD]: 'builder',
  [LlmTask.BUILDER_LESSON_CURATION]: 'builder',
  [LlmTask.BUILDER_OUTCOME_CATEGORISE]: 'builder',
  [LlmTask.BUILDER_CONTEXT_SELECTION]: 'builder',
  [LlmTask.BUILDER_EPIC_DECOMPOSITION]: 'builder',
  [LlmTask.BUILDER_RESEARCH]: 'builder',
  [LlmTask.BUILDER_INTERVIEW_SUMMARY]: 'builder',
};

/** One (bucket, task, service, provider, model) group of coding-agent AI usage. */
export interface CodingAgentUsageRow {
  /** Bucket start, `yyyy-mm-dd`. */
  bucket: string;
  /** Raw `llm_usage.task`; mapped to an agent by {@link TASK_AGENT}. */
  task: string;
  service: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  audioMs: number;
  characters: number;
  calls: number;
}

/**
 * AI spend for Bug Hunter and Builder specifically, grouped finely enough to
 * be priced at read time and split by agent and by model.
 *
 * Same conventions as its sibling `RoleplayCostAnalyticsRepository`: raw SQL
 * over `llm_usage` by name, `date_trunc`'s grain travels as a bound
 * parameter, quantities out as `::bigint` and re-parsed defensively.
 * Platform-wide, not tenant-scoped — most rows here are tenantless by design
 * (Bug Hunter and Builder both run outside any one tenant's context).
 *
 * The task filter is bound from `Object.keys(TASK_AGENT)` rather than
 * hand-written as a second `CASE`/`LIKE` in SQL, so the query's idea of
 * "these two agents' tasks" and the service's classification of the same
 * rows can never drift apart.
 */
@Injectable()
export class CodingAgentCostAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Same measurement every sibling cost tab uses for its "all time" left edge. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  async getUsageByBucketAndTask(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<CodingAgentUsageRow[]> {
    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(date_trunc($1, lu."occurredAt"), 'YYYY-MM-DD')  AS "bucket",
        lu.task                                                 AS "task",
        lu.service                                              AS "service",
        lu.provider                                             AS "provider",
        lu.model                                                AS "model",
        COALESCE(SUM(lu."promptTokens"), 0)::bigint             AS "promptTokens",
        COALESCE(SUM(lu."completionTokens"), 0)::bigint         AS "completionTokens",
        COALESCE(SUM(lu."audioMs"), 0)::bigint                  AS "audioMs",
        COALESCE(SUM(lu."characters"), 0)::bigint               AS "characters",
        COUNT(*)::int                                           AS "calls"
      FROM llm_usage lu
      WHERE lu."occurredAt" >= $2
        AND lu."occurredAt" < $3
        AND lu.task = ANY($4::text[])
        AND ${excludeTestTenants('lu."tenant_id"')}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1 ASC
      `,
      [bucket, start, end, Object.keys(TASK_AGENT)],
    );

    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      task: (r.task as string) ?? 'unknown',
      service: (r.service as string) ?? 'llm',
      provider: (r.provider as string) ?? 'unknown',
      model: (r.model as string) ?? 'unknown',
      promptTokens: Number(r.promptTokens) || 0,
      completionTokens: Number(r.completionTokens) || 0,
      audioMs: Number(r.audioMs) || 0,
      characters: Number(r.characters) || 0,
      calls: Number(r.calls) || 0,
    }));
  }
}
