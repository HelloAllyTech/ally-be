import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { excludeTestTenants } from '../util/test-tenant.util';
import { ChatSummaryStatus } from '../../chat/entity/chat.entity';
import { ScribePhaseReached } from '../../chat/entity/chat-summary-attempt.entity';
import { CHAT_SUMMARY_TIMEOUT_ERROR } from '../../chat/constants/chat.constants';
import {
  AudioChatProvider,
  ScribeSessionMode,
} from '../../common/constants/chat.constants';
import { AnalyticsBucket } from './platform-analytics.repository';

export interface ScribeBucketCountRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  count: number;
}

export interface ScribeKeyCountRow {
  key: string;
  count: number;
}

export interface ScribeFailureRateRow {
  bucket: string;
  failed: number;
  terminal: number;
}

export interface ScribeProviderStatRow {
  provider: string;
  tried: number;
  ok: number;
  failed: number;
}

/**
 * Raw aggregation for the super-admin SCRIBE-session analytics, over the
 * `chats` table (real counselor sessions transcribed + summarised) — the
 * counterpart to {@link PlatformAnalyticsRepository}, which covers AI/simulation
 * analytics over `scenario_sessions`.
 *
 * Uses a `DataSource`-backed query builder (the queries span `chats` and
 * `call_details`). Columns are the default TypeORM camelCase identifiers
 * (quoted); `tenant_id` is the only snake_case column. These are platform-wide
 * (super-admin) metrics, so they are deliberately NOT scoped to a tenant.
 *
 * Truncated dates are returned as `yyyy-mm-dd` strings (`to_char`) so the keys
 * line up with the service's UTC-generated axis regardless of process timezone.
 * Counts are cast to `::int` so the pg driver returns JS numbers.
 */
@Injectable()
export class ScribeAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): 'day' | 'week' | 'month' {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    return 'week';
  }

  /** Scribe sessions created per time bucket within [start, end). */
  async getSessionsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<ScribeBucketCountRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', c."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) || 0 }));
  }

  /** Session counts grouped by summaryStatus within [start, end). */
  async getOutcomeCounts(start: Date, end: Date): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('c."summaryStatus"', 'key')
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .groupBy('c."summaryStatus"')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Session counts grouped by scribe mode (SCRIBE upload vs DICTATION live)
   * within [start, end). Mode lives on `call_details.callInfo->>'mode'`; a chat
   * with no call_details row or no mode is treated as SCRIBE, matching how the
   * summary pipeline defaults it.
   */
  async getModeCounts(start: Date, end: Date): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `COALESCE(NULLIF(cd."callInfo"->>'mode', ''), :defaultMode)`,
        'key',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .leftJoin('call_details', 'cd', 'cd."chatId" = c.id')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .setParameter('defaultMode', ScribeSessionMode.SCRIBE)
      .groupBy('key')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * ALL scribe sessions in [start, end) grouped by CAPTURE METHOD
   * (call_details.callInfo->>'provider'): AUDIO_UPLOAD = uploaded file, anything
   * else = live streaming, null/'' = unknown. This is how the audio was
   * recorded — distinct from note mode (getModeCounts) — and is the same
   * grouping as getFailuresByCaptureMethod but across every session, not only
   * failures.
   */
  async getCaptureMethodCounts(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `CASE
          WHEN cd."callInfo"->>'provider' = :uploadProvider THEN 'upload'
          WHEN NULLIF(cd."callInfo"->>'provider', '') IS NULL THEN 'unknown'
          ELSE 'live'
        END`,
        'key',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .leftJoin('call_details', 'cd', 'cd."chatId" = c.id')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .setParameter('uploadProvider', AudioChatProvider.AUDIO_UPLOAD)
      .groupBy('key')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Per-bucket failed and terminal (SUCCESS + FAILED) counts within [start,
   * end). The failure rate is failed/terminal; NO_AUDIO and in-flight
   * (PENDING/IN_PROGRESS) sessions are excluded from the denominator because
   * they have no summary outcome yet.
   */
  async getFailureRateByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<ScribeFailureRateRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', c."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE c."summaryStatus" = :failed)::int`,
        'failed',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE c."summaryStatus" IN (:...terminal))::int`,
        'terminal',
      )
      .from('chats', 'c')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .setParameter('failed', ChatSummaryStatus.FAILED)
      .setParameter('terminal', [
        ChatSummaryStatus.SUCCESS,
        ChatSummaryStatus.FAILED,
      ])
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; failed: number; terminal: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      failed: Number(r.failed) || 0,
      terminal: Number(r.terminal) || 0,
    }));
  }

  /**
   * A single unified classification of each FAILED scribe session in
   * [start, end) — one bucket per failure, most-specific cause first. Combines
   * the stored-audio lifecycle state (LEFT JOIN chat_audio_uploads) with the
   * pipeline stage / error metadata, so it replaces the separate
   * failures-by-stage, top-reasons and audio-state breakdowns:
   *   1. Audio lifecycle (root cause when present): never finalized (abnormal
   *      session end), upload failed, or audio cleared.
   *   2. Otherwise the pipeline signal: summary timeout, transcription/
   *      diarization error, summarization error, dead-letter.
   *   3. Otherwise the raw error text (first 60 chars), else 'Unknown'.
   */
  async getFailureBreakdown(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `CASE
          WHEN au.id IS NOT NULL AND LOWER(au.status) = 'pending'
            THEN 'Upload never finalized (abnormal end)'
          WHEN au.id IS NOT NULL AND LOWER(au.status) = 'failed'
            THEN 'Audio upload failed'
          WHEN au.id IS NOT NULL AND au."storageKey" IS NULL
            THEN 'Audio cleared'
          WHEN c."metadata"->>'error' = :timeoutError
               OR c."metadata"->>'stage' = 'summary-timeout'
            THEN 'Summary timed out'
          WHEN c."metadata"->>'stage' IN ('transcribe', 'diarize')
            THEN 'Transcription error'
          WHEN c."metadata"->>'stage' = 'summarize'
            THEN 'Summarization error'
          WHEN c."metadata"->>'dlq_message' IS NOT NULL
            THEN 'Dead-letter (retries exhausted)'
          WHEN NULLIF(c."metadata"->>'error', '') IS NOT NULL
            THEN LEFT(c."metadata"->>'error', 60)
          ELSE 'Unknown'
        END`,
        'key',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .leftJoin('chat_audio_uploads', 'au', 'au."chatId" = c.id')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .andWhere('c."summaryStatus" = :failed', {
        failed: ChatSummaryStatus.FAILED,
      })
      .setParameter('timeoutError', CHAT_SUMMARY_TIMEOUT_ERROR)
      .groupBy('key')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * FAILED scribe sessions in [start, end) grouped by session mode
   * (call_details.callInfo->>'mode': DICTATION = live, SCRIBE = upload). This
   * is the belt-and-suspenders confirmation that failures concentrate in live
   * sessions. Missing mode is bucketed as 'UNKNOWN' (not defaulted to SCRIBE)
   * so it isn't masked.
   */
  async getFailuresByMode(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(`COALESCE(NULLIF(cd."callInfo"->>'mode', ''), 'UNKNOWN')`, 'key')
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .leftJoin('call_details', 'cd', 'cd."chatId" = c.id')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .andWhere('c."summaryStatus" = :failed', {
        failed: ChatSummaryStatus.FAILED,
      })
      .groupBy('key')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * FAILED scribe sessions in [start, end) grouped by CAPTURE METHOD
   * (call_details.callInfo->>'provider'): AUDIO_UPLOAD = an uploaded file,
   * anything else (MICROPHONE / WEBRTC / telephony) = live streaming. This is
   * distinct from note mode (SCRIBE/DICTATION) — a live session can carry
   * either mode — and is the dimension that actually reflects the durable-
   * capture bug (which only affects streamed audio).
   */
  async getFailuresByCaptureMethod(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `CASE
          WHEN cd."callInfo"->>'provider' = :uploadProvider THEN 'upload'
          WHEN NULLIF(cd."callInfo"->>'provider', '') IS NULL THEN 'unknown'
          ELSE 'live'
        END`,
        'key',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('chats', 'c')
      .leftJoin('call_details', 'cd', 'cd."chatId" = c.id')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .andWhere('c."summaryStatus" = :failed', {
        failed: ChatSummaryStatus.FAILED,
      })
      .setParameter('uploadProvider', AudioChatProvider.AUDIO_UPLOAD)
      .groupBy('key')
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Among FAILED scribe sessions in [start, end), split into retryable
   * (`metadata->>'summaryRetryable' = 'true'`, transcript saved → recoverable)
   * vs terminal (no transcript / not recoverable).
   */
  async getFailureRetryableCounts(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select(
        `COUNT(*) FILTER (WHERE c."metadata"->>'summaryRetryable' = 'true')::int`,
        'retryable',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE COALESCE(c."metadata"->>'summaryRetryable', 'false') <> 'true')::int`,
        'terminal',
      )
      .from('chats', 'c')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .andWhere('c."summaryStatus" = :failed', {
        failed: ChatSummaryStatus.FAILED,
      })
      .getRawOne<{ retryable: number; terminal: number }>();

    return [
      { key: 'retryable', count: Number(row?.retryable) || 0 },
      { key: 'terminal', count: Number(row?.terminal) || 0 },
    ];
  }

  /**
   * Among FAILED scribe sessions in [start, end), split into summary-timeout
   * (the reaper marked it `error = CHAT_SUMMARY_TIMEOUT_ERROR`) vs any other
   * error reason.
   */
  async getFailureTimeoutCounts(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select(
        `COUNT(*) FILTER (WHERE c."metadata"->>'error' = :timeoutError)::int`,
        'timeout',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE COALESCE(c."metadata"->>'error', '') <> :timeoutError)::int`,
        'other',
      )
      .from('chats', 'c')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .andWhere('c."summaryStatus" = :failed', {
        failed: ChatSummaryStatus.FAILED,
      })
      .setParameter('timeoutError', CHAT_SUMMARY_TIMEOUT_ERROR)
      .getRawOne<{ timeout: number; other: number }>();

    return [
      { key: 'timeout', count: Number(row?.timeout) || 0 },
      { key: 'other', count: Number(row?.other) || 0 },
    ];
  }

  /**
   * Per-bucket FIRST-ATTEMPT failed + terminal counts within [start, end), read
   * from the write-once `chats.firstAttemptStatus`. Unlike getFailureRateByBucket
   * (which reads the mutable `summaryStatus` and so drops to the post-backfill
   * residual), this is the true initial-run failure rate — the health signal
   * that survives a retry healing the session. Only sessions instrumented after
   * the attempt-tracking rollout have a non-null firstAttemptStatus, so the
   * denominator is naturally limited to those.
   */
  async getFirstAttemptFailureRateByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<ScribeFailureRateRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', c."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE c."firstAttemptStatus" = :failed)::int`,
        'failed',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE c."firstAttemptStatus" IN (:...terminal))::int`,
        'terminal',
      )
      .from('chats', 'c')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .setParameter('failed', ChatSummaryStatus.FAILED)
      .setParameter('terminal', [
        ChatSummaryStatus.SUCCESS,
        ChatSummaryStatus.FAILED,
      ])
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; failed: number; terminal: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      failed: Number(r.failed) || 0,
      terminal: Number(r.terminal) || 0,
    }));
  }

  /**
   * Per-session drop-off across the pipeline phase ladder, for sessions created
   * in [start, end). For each chat we take the FURTHEST phase any of its
   * attempts reached (a session that eventually succeeded via retry counts as
   * `delivered`), then count how many sessions ended at each phase. Replaces the
   * flat failure breakdown with a "where sessions stop" funnel. Keyed by phase;
   * the service turns the drop-off distribution into cumulative reached counts.
   */
  async getPhaseDropoff(start: Date, end: Date): Promise<ScribeKeyCountRow[]> {
    // Raw SQL: TypeORM's query builder mangles the ARRAY[...] indexing and the
    // derived-table subquery (emitting invalid quoted identifiers), so use a
    // parameterized raw query. `count` comes back ::int -> JS number.
    const ladder =
      `ARRAY['created','audio-uploaded','transcribed','diarized',` +
      `'summarized','delivered']`;
    const rows = await this.dataSource.query<{ key: string; count: number }[]>(
      `SELECT per_chat.phase AS key, COUNT(*)::int AS count
       FROM (
         SELECT a."chatId",
           (${ladder})[
             MAX(COALESCE(array_position(${ladder}, a."phaseReached"), 1))
           ] AS phase
         FROM chat_summary_attempts a
         INNER JOIN chats c ON c.id = a."chatId"
         WHERE c."createdAt" >= $1 AND c."createdAt" < $2
           AND ${excludeTestTenants('c."tenant_id"')}
         GROUP BY a."chatId"
       ) per_chat
       GROUP BY per_chat.phase`,
      [start, end],
    );

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /**
   * Per-STT-provider try/success/fail counts over the per-attempt provider trail
   * (`chat_summary_attempts.sttAttempts`, a jsonb array of {provider, ok}),
   * for sessions created in [start, end). Expands the array with
   * jsonb_array_elements so each provider attempt is one row. This is the panel
   * that shows which STT engine actually fails (only populated once ally-ai
   * emits the trail).
   */
  async getSttProviderStats(
    start: Date,
    end: Date,
  ): Promise<ScribeProviderStatRow[]> {
    // Raw SQL: the query builder can't express the LATERAL jsonb_array_elements
    // expansion (it emits a zero-length quoted identifier and the query fails),
    // so use a parameterized raw query.
    const rows = await this.dataSource.query<
      { provider: string; tried: number; ok: number; failed: number }[]
    >(
      `SELECT elem->>'provider' AS provider,
              COUNT(*)::int AS tried,
              COUNT(*) FILTER (WHERE (elem->>'ok')::boolean)::int AS ok,
              COUNT(*) FILTER (WHERE NOT (elem->>'ok')::boolean)::int AS failed
       FROM chat_summary_attempts a
       INNER JOIN chats c ON c.id = a."chatId"
       CROSS JOIN LATERAL jsonb_array_elements(a."sttAttempts") elem
       WHERE c."createdAt" >= $1 AND c."createdAt" < $2
         AND a."sttAttempts" IS NOT NULL
         AND ${excludeTestTenants('c."tenant_id"')}
       GROUP BY elem->>'provider'
       ORDER BY tried DESC`,
      [start, end],
    );

    return rows.map((r) => ({
      provider: r.provider,
      tried: Number(r.tried) || 0,
      ok: Number(r.ok) || 0,
      failed: Number(r.failed) || 0,
    }));
  }

  /**
   * Per-LLM-model summary counts (successful summaries) for sessions created in
   * [start, end), from `chat_summary_attempts.summaryModel`. Only populated once
   * ally-ai emits the model name.
   */
  async getSummaryModelStats(
    start: Date,
    end: Date,
  ): Promise<ScribeKeyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(`a."summaryModel"`, 'key')
      .addSelect('COUNT(*)::int', 'count')
      .from('chat_summary_attempts', 'a')
      .innerJoin('chats', 'c', 'c.id = a."chatId"')
      .where('c."createdAt" >= :start', { start })
      .andWhere('c."createdAt" < :end', { end })
      .andWhere(excludeTestTenants('c."tenant_id"'))
      .andWhere(`NULLIF(a."summaryModel", '') IS NOT NULL`)
      .andWhere('a.outcome = :success', { success: 'success' })
      .groupBy(`a."summaryModel"`)
      .orderBy('count', 'DESC')
      .getRawMany<{ key: string; count: number }>();

    return rows.map((r) => ({ key: r.key, count: Number(r.count) || 0 }));
  }

  /** Ordered phase ladder used by the drop-off funnel. */
  static readonly PHASE_LADDER: ScribePhaseReached[] = [
    ScribePhaseReached.CREATED,
    ScribePhaseReached.AUDIO_UPLOADED,
    ScribePhaseReached.TRANSCRIBED,
    ScribePhaseReached.DIARIZED,
    ScribePhaseReached.SUMMARIZED,
    ScribePhaseReached.DELIVERED,
  ];
}
