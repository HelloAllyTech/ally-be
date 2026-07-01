import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChatSummaryStatus } from '../../chat/entity/chat.entity';
import { CHAT_SUMMARY_TIMEOUT_ERROR } from '../../chat/constants/chat.constants';
import { ScribeSessionMode } from '../../common/constants/chat.constants';
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
      .setParameter('defaultMode', ScribeSessionMode.SCRIBE)
      .groupBy('key')
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
}
