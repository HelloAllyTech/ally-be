import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/** One bucket of the XP series. */
export interface XpBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** XP awarded in the bucket. */
  xpEarned: number;
  /** Distinct learners who earned any XP in the bucket. */
  earners: number;
}

/** Window aggregate, over the window as a whole rather than per bucket. */
export interface XpWindowTotalsRow {
  xp: number;
  /** Distinct learners across the WHOLE window — not summable from buckets. */
  earners: number;
}

/**
 * Platform XP, read from the append-only ledger.
 *
 * `xp_events` is the source rather than `user_progress`: the rollup holds only
 * a learner's current total with no time dimension, so it can answer "how much
 * XP exists" but not "when was it earned". The ledger can answer both, and the
 * two are written in the same transaction, so they agree.
 *
 * Bucketing is on `awardedOn` — the calendar day the award COUNTS AGAINST in the
 * tenant's business timezone — not on `createdAt`. The two differ for a session
 * that straddles midnight and for every backfilled row (created on the migration
 * date, awarded on the historical day it belongs to). Bucketing by `createdAt`
 * would pile the platform's entire pre-launch history onto the day the Progress
 * dashboard shipped, which would draw the one shape this chart exists to avoid:
 * a vertical cliff at a deploy.
 *
 * Conventions follow the sibling repositories: `DataSource` query builder over
 * tables BY NAME (no entity repos), quoted camelCase identifiers (only
 * `tenant_id` is snake_case), truncated dates out as `yyyy-mm-dd` strings, and
 * aggregates re-parsed defensively — `SUM` comes back from the pg driver as a
 * string, so the cast alone is not enough.
 */
@Injectable()
export class XpGrowthAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   *
   * The PLATFORM floor (first user or session), not the first `xp_events` row.
   * Deliberate: this chart sits beside "Cumulative users" on the same axis, and
   * a curve that started at the first XP award would be offset from the one
   * beside it for no reason a reader could see. Buckets before the first award
   * carry a real zero — "no XP had been earned yet" is a measurement.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * XP and distinct earners per bucket, within [start, end).
   *
   * Buckets with no awards are ABSENT; the service puts them back on the axis
   * with a zero and carries the running total forward.
   */
  async getXpByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<XpBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', e."awardedOn"), 'YYYY-MM-DD')`,
        'bucket',
      )
      // bigint, not int: a running platform total is the one aggregate here with
      // no natural ceiling, and an overflow would surface as a 500 years from now
      // rather than as a number anybody could question.
      .addSelect('COALESCE(SUM(e."xp"), 0)::bigint', 'xpEarned')
      .addSelect('COUNT(DISTINCT e."userId")::int', 'earners')
      .from('xp_events', 'e')
      .where('e."awardedOn" >= :start', { start })
      .andWhere('e."awardedOn" < :end', { end })
      .andWhere(excludeTestTenants('e."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('e."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; xpEarned: string; earners: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      xpEarned: Number(r.xpEarned) || 0,
      earners: Number(r.earners) || 0,
    }));
  }

  /**
   * XP awarded strictly before `date` — the cumulative curve's opening value.
   *
   * Without it a window narrower than all of history would restart the running
   * total at zero, and a chart labelled "lifetime XP" would show a platform that
   * had just been born. One extra cheap aggregate is the price of the line
   * meaning what its axis says.
   */
  async getXpBefore(date: Date, tenantId?: string): Promise<number> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(e."xp"), 0)::bigint', 'xp')
      .from('xp_events', 'e')
      .where('e."awardedOn" < :date', { date })
      .andWhere(excludeTestTenants('e."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('e."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{ xp: string }>();

    return Number(row?.xp) || 0;
  }

  /**
   * Window totals: XP, and the distinct learners behind it.
   *
   * The XP sum is recoverable from the buckets, but the learner count is not —
   * a learner active in three months is one learner, and adding the per-bucket
   * counts would report three. Both come from one query so the summary cannot
   * disagree with itself about which rows it covered.
   */
  async getWindowTotals(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<XpWindowTotalsRow> {
    const qb = this.dataSource
      .createQueryBuilder()
      .select('COALESCE(SUM(e."xp"), 0)::bigint', 'xp')
      .addSelect('COUNT(DISTINCT e."userId")::int', 'earners')
      .from('xp_events', 'e')
      .where('e."awardedOn" >= :start', { start })
      .andWhere('e."awardedOn" < :end', { end })
      .andWhere(excludeTestTenants('e."tenant_id"'));
    if (tenantId) {
      qb.andWhere(scopeToTenant('e."tenant_id"', ':tenantId'), { tenantId });
    }
    const row = await qb.getRawOne<{ xp: string; earners: number }>();

    return {
      xp: Number(row?.xp) || 0,
      earners: Number(row?.earners) || 0,
    };
  }
}
