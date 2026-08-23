import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { AnalyticsBucket } from './platform-analytics.repository';
import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/**
 * Which part of the learner's experience an AI call belongs to.
 *
 * The question this serves — "what does ten minutes of roleplay cost us" — is
 * about the cost of DELIVERING LEARNING, so the areas are the three things a
 * learner receives: the live conversation, the feedback afterwards, and quiz
 * grading. Everything else the platform spends AI on is real money but is not
 * caused by a learner practising, and averaging it into a per-minute figure would
 * make the unit cost move whenever someone built a scenario or a judge ran a
 * backfill.
 */
export const COST_AREAS = ['roleplay', 'feedback', 'quiz'] as const;
export type CostArea = (typeof COST_AREAS)[number];

/** Admin-facing names for the areas, in the order they are shown. */
export const COST_AREA_LABELS: Record<CostArea, string> = {
  roleplay: 'Live roleplay',
  feedback: 'Feedback & summary',
  quiz: 'Quiz grading',
};

/**
 * Task → area. A task absent from this map is EXCLUDED from the per-minute cost
 * and reported separately as non-learner spend.
 *
 * Membership is judged by one test: would this call have happened if a learner
 * had not just practised? The live agent's turns, its speech recognition and its
 * voice all would not, so they are roleplay. The end-of-session evaluation,
 * summary and memory fold would not, so they are feedback. Quiz grading follows a
 * learner submitting an answer.
 *
 * Deliberately NOT included, and each for a reason worth stating:
 *  - **Judges** (drift, language, groundedness) are OUR measurement of the
 *    product, not part of it. They scale with how much we choose to evaluate.
 *  - **Studio, copilot, autofill, translation, cover images** are build-time
 *    costs. They scale with authoring activity and would make the unit cost spike
 *    in a week when nobody practised but somebody wrote ten scenarios.
 *  - **Analytics agent, suggestions, Bug Hunter** are internal tooling.
 *  - **Embeddings and diarization** are shared infrastructure whose calls cannot
 *    be attributed to one learner's session from `llm_usage` alone.
 *
 * `NUDGE` counts as roleplay: it fires during a live session to steer the
 * conversation, so it is part of what the learner is experiencing.
 */
export const TASK_AREA: Partial<Record<LlmTask, CostArea>> = {
  [LlmTask.AGENT_TURN]: 'roleplay',
  [LlmTask.AGENT_STT]: 'roleplay',
  [LlmTask.AGENT_TTS]: 'roleplay',
  [LlmTask.ROLLING_SUMMARY]: 'roleplay',
  [LlmTask.CLIENT_WORKING_MEMORY]: 'roleplay',
  [LlmTask.NUDGE]: 'roleplay',
  [LlmTask.SUMMARY]: 'feedback',
  [LlmTask.DYNAMIC_SUMMARY]: 'feedback',
  [LlmTask.SCENARIO_EVALUATION]: 'feedback',
  [LlmTask.COUNSELOR_ANALYSIS]: 'feedback',
  [LlmTask.TRACK_MEMORY_FOLD]: 'feedback',
  [LlmTask.TRACK_QUIZ_GRADING]: 'quiz',
};

/**
 * Minutes of roleplay the unit cost is quoted per.
 *
 * Ten, not one. A per-minute figure for these models lands in hundredths of a
 * cent, where every value on the axis is a string of leading zeros and a reader
 * cannot tell a 20% rise from a rounding artefact. Ten minutes is also close to a
 * typical session, so the number reads as "what a practice session costs".
 */
export const COST_PER_MINUTES = 10;

/** One (bucket, task, service, provider, model) group of AI usage. */
export interface CostUsageRow {
  /** Bucket start, `yyyy-mm-dd`. */
  bucket: string;
  /** Raw `llm_usage.task`; mapped to an area by {@link TASK_AREA}. */
  task: string;
  /** 'llm' | 'stt' | 'tts'. */
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
 * AI spend attributable to learners, grouped finely enough to be priced and split
 * by area at read time.
 *
 * ## Why the grouping is this wide
 *
 * Cost is derived from raw quantities in TypeScript (see
 * `llm-pricing.constants`), never in SQL, so every dimension pricing depends on
 * — service, provider, model — has to survive the aggregation, and `task` has to
 * as well because it is what decides the area. Grouping any coarser would mean
 * pricing a blend of models at one rate.
 *
 * ## Platform-wide, always
 *
 * Most `llm_usage` rows are deliberately tenantless (judges, autofill,
 * translation, and the live agent itself in some paths), so a tenant-filtered
 * cost figure would silently report a fraction of real spend as though it were
 * the whole. This repository therefore takes no tenant parameter at all, rather
 * than accepting one and quietly ignoring it, and the service names the sections
 * as unscoped. The `excludeTestTenants` predicate is still applied and is
 * null-preserving, so tenantless rows survive it while a QA org's spend does not.
 *
 * ## Conventions
 *
 * Raw SQL over tables BY NAME; `date_trunc`'s grain travels as a bound parameter;
 * quantities out as `::bigint` and re-parsed defensively, because a busy month's
 * token count exceeds what a JS number holds exactly only far above these
 * volumes but the cast keeps the contract identical to the sibling cost query.
 */
@Injectable()
export class RoleplayCostAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * Deliberately the same measurement every sibling endpoint uses, so charts
   * composed onto one tab cover the same period rather than two axes that
   * nearly line up. See {@link getPlatformDataFloor}.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  async getUsageByBucketAndTask(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<CostUsageRow[]> {
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
        AND ${excludeTestTenants('lu."tenant_id"')}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1 ASC
      `,
      [bucket, start, end],
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
