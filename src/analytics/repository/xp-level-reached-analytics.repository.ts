import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LEVEL_THRESHOLDS } from 'src/progress/progress.constants';
import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/** One (bucket, level) crossing count. `level` is 1-indexed, matching `resolveLevel`. */
export interface XpLevelCrossingRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** 1-indexed level, e.g. 2 = `LEVEL_THRESHOLDS[1]`. */
  level: number;
  /** Learners who FIRST reached this level in this bucket. */
  users: number;
}

/**
 * Unique learners reaching each XP level for the first time, per bucket.
 *
 * Mirrors `UsageLadderAnalyticsRepository.getAttainmentByPeriod` — the identical
 * shape of problem ("distinct users reaching rung N for the first time in
 * period P") for a different metric (lifetime XP instead of lifetime practice
 * minutes): a running per-user total, computed with a window function, and a
 * rung's crossing bucket is the FIRST bucket whose running total clears it
 * (`MIN(bucket) FILTER (WHERE cumulative >= threshold)`). Because the running
 * total is monotonic, that MIN is exactly the first crossing — there is no need
 * to additionally check the total just before it, the same shortcut the usage
 * ladder repository takes.
 *
 * Computed from `xp_events`, not `user_progress.totalXp`/`lastLevelUpAt`: the
 * rollup holds only a learner's CURRENT total with no time dimension, and
 * `lastLevelUpAt` records only the single most recent level-up, not the full
 * history a time-bucketed chart needs.
 *
 * ## Level 1 is a special case, by construction
 *
 * `LEVEL_THRESHOLDS[0]` is 0 XP — every account is "level 1" from the moment it
 * exists, with or without ever opening a simulation. A user with zero
 * `xp_events` rows never appears in this query at all (there is nothing to
 * bucket), so in practice `MIN(bucket) FILTER (WHERE cumulative >= 0)` resolves
 * to the bucket of a learner's very FIRST XP award ever — level 1's series is
 * therefore best read as "learners who started earning XP", not "learners who
 * created an account". This is a deliberate, useful reading of the same
 * one-sided crossing rule that produces every other level's series, not a
 * special-cased branch.
 *
 * ALL-TIME by construction (no lower bound on the ledger read): a windowed
 * running total would misattribute a crossing that actually happened earlier to
 * whatever bucket the window happens to start in — see the usage ladder
 * repository's doc comment for the same reasoning. The caller (the service)
 * fetches crossings through `endExclusive` and keeps only the ones landing on
 * or after the requested window's start.
 */
@Injectable()
export class XpLevelReachedAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal by the time it reaches here, but
    // never interpolate anything not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'quarter') return 'quarter';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /** Where the platform's data begins — the left edge of an all-time window. */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Every learner's first-ever crossing into each level, for crossings landing
   * strictly before `endExclusive`. One row per (bucket, level) that had at
   * least one crossing; a (bucket, level) with none is simply absent — the
   * service gap-fills the axis and every level (1..MAX_LEVEL) per bucket.
   */
  async getLevelCrossings(
    endExclusive: Date,
    bucket: AnalyticsBucket,
  ): Promise<XpLevelCrossingRow[]> {
    const trunc = this.resolveBucket(bucket);
    const params: unknown[] = [endExclusive];

    // Thresholds travel as bound parameters, like the grain does via `trunc`
    // above (whitelisted, not interpolated) — the ladder is a module constant
    // today, but a value inlined "because it is ours" is the habit that
    // eventually inlines one that is not.
    const thresholdColumns = LEVEL_THRESHOLDS.map((threshold, i) => {
      params.push(threshold);
      return (
        `MIN(bucket) FILTER (WHERE cumulative >= $${params.length}) ` +
        `AS "crossed${i}"`
      );
    }).join(',\n               ');

    // One (level, bucket) row per crossing, unpivoted from the per-user crossing
    // columns — same shape as UsageLadderAnalyticsRepository's `crossingUnion`.
    const crossingUnion = LEVEL_THRESHOLDS.map(
      (_, i) =>
        `SELECT "crossed${i}" AS bucket, ${i + 1} AS level ` +
        `FROM crossings WHERE "crossed${i}" IS NOT NULL`,
    ).join('\n        UNION ALL\n        ');

    const rows = await this.dataSource.query(
      `
      WITH per_user_bucket AS (
        SELECT e."userId"                            AS user_id,
               date_trunc('${trunc}', e."awardedOn")  AS bucket,
               SUM(e."xp")                             AS xp
        FROM xp_events e
        WHERE e."awardedOn" < $1
          AND ${excludeTestTenants('e."tenant_id"')}
        GROUP BY e."userId", bucket
      ),
      running AS (
        SELECT user_id,
               bucket,
               SUM(xp) OVER (
                 PARTITION BY user_id
                 ORDER BY bucket
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS cumulative
        FROM per_user_bucket
      ),
      crossings AS (
        SELECT user_id,
               ${thresholdColumns}
        FROM running
        GROUP BY user_id
      ),
      unpivoted AS (
        ${crossingUnion}
      )
      SELECT to_char(bucket, 'YYYY-MM-DD') AS "bucket",
             level                         AS "level",
             COUNT(*)::int                 AS "users"
      FROM unpivoted
      GROUP BY bucket, level
      ORDER BY bucket ASC, level ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      bucket: r.bucket as string,
      level: Number(r.level),
      users: Number(r.users) || 0,
    }));
  }
}
