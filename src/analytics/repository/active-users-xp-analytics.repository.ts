import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/**
 * Product-chosen floor for "active" (Sandeep, 2026-09-22): a learner counts as
 * active in a bucket when they earned AT LEAST this much XP WITHIN it. This is
 * not derived from any curve, percentile or historical average — it is a
 * deliberate, tunable line the product owner picked directly. Exported so the
 * SQL and the DTO's description quote the same number; change it here and both
 * follow.
 */
export const ACTIVE_USER_XP_THRESHOLD = 100;

/** One bucket of the active-users series. */
export interface ActiveUsersXpBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** Distinct learners whose XP earned WITHIN this bucket cleared the threshold. */
  activeUsers: number;
}

/**
 * Learners clearing the per-bucket XP activity bar, read from the append-only
 * ledger.
 *
 * Reads `xp_events` rather than `user_progress`: the threshold is evaluated PER
 * BUCKET ("earned >=100 XP this week"), not against a lifetime total, so only
 * the ledger's award-by-award history can answer it. Bucketed on `awardedOn` —
 * the calendar day an award counts against in the tenant's business timezone —
 * matching `XpGrowthAnalyticsRepository`'s convention and its doc comment for
 * why (a session straddling midnight, and every backfilled row, keeps its
 * historical date rather than piling onto the day this chart shipped).
 *
 * A raw parameterised CTE rather than `DataSource.createQueryBuilder()`: this
 * query needs "group per user per bucket, then count how many users clear a
 * threshold", which is a subquery of its own that the query builder cannot
 * express in one fluent chain — the same shape `UsageLadderAnalyticsRepository`
 * solves the same way. Conventions otherwise follow the sibling repositories:
 * tables BY NAME (no entity repos), quoted camelCase identifiers (only
 * `tenant_id` is snake_case), dates out as `yyyy-mm-dd` strings, counts `::int`
 * and re-parsed defensively.
 */
@Injectable()
export class ActiveUsersXpAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal by the time it reaches here, but
    // never interpolate anything not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * The PLATFORM floor (first user or session), matching every sibling chart on
   * this tab, so a reader can reconcile axes across charts.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Distinct learners per bucket whose bucket-scoped XP sum reaches
   * {@link ACTIVE_USER_XP_THRESHOLD}, within [start, end).
   *
   * Buckets with nobody clearing the bar are ABSENT; the service puts them back
   * on the axis with a real zero.
   */
  async getActiveUsersByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<ActiveUsersXpBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource.query(
      `
      WITH per_user_bucket AS (
        SELECT date_trunc('${trunc}', e."awardedOn") AS bucket,
               e."userId"                             AS user_id,
               SUM(e."xp")                             AS xp
        FROM xp_events e
        WHERE e."awardedOn" >= $1
          AND e."awardedOn" < $2
          AND ${excludeTestTenants('e."tenant_id"')}
        GROUP BY bucket, e."userId"
      )
      SELECT to_char(bucket, 'YYYY-MM-DD')      AS "bucket",
             COUNT(*) FILTER (WHERE xp >= $3)::int AS "activeUsers"
      FROM per_user_bucket
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      [start, end, ACTIVE_USER_XP_THRESHOLD],
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      bucket: r.bucket as string,
      activeUsers: Number(r.activeUsers) || 0,
    }));
  }
}
