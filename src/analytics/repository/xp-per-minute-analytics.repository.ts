import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';
import { resolveSqlBucket } from '../util/analytics-window.util';

/** XP awarded under one rule in one bucket. */
export interface XpByRuleBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  rule: string;
  xp: number;
}

/** Roleplay minutes practised in one bucket. */
export interface RoleplayMinutesBucketRow {
  bucket: string;
  minutes: number;
}

/**
 * The two sides of "XP per roleplay minute", each read from its own source of
 * record and bucketed on its own calendar day:
 *
 *  - **XP** from the append-only ledger `xp_events`, on `awardedOn` — the day the
 *    award counts against. Never `createdAt`: the launch backfill's rows were
 *    created on the migration date and would pile history onto one day.
 *  - **Minutes** from `user_daily_scores.minutesPlayed`, on `date` — the same
 *    query as the Priority tab's "Roleplay Minutes" (highlights repository), so
 *    the denominator reconciles 1:1 with the chart directly above this one.
 *
 * Both are DATE columns, so `date_trunc` is pure calendar math and the two
 * series land on the same axis without any timezone conversion.
 *
 * Platform-wide: test tenants are excluded on both sides and nothing narrows
 * further — the Priority tab has no tenant filter.
 */
@Injectable()
export class XpPerMinuteAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    return resolveSqlBucket(
      bucket,
      ['day', 'week', 'month', 'quarter', 'year'],
      'month',
    );
  }

  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * XP per bucket per rule within [start, end). Grouped on the raw rule so the
   * rule → source mapping lives in one TypeScript constant, not in SQL.
   */
  async getXpByBucketAndRule(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<XpByRuleBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', e."awardedOn"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('e."rule"', 'rule')
      .addSelect('COALESCE(SUM(e."xp"), 0)::bigint', 'xp')
      .from('xp_events', 'e')
      .where('e."awardedOn" >= :start', { start })
      .andWhere('e."awardedOn" < :end', { end })
      .andWhere(excludeTestTenants('e."tenant_id"'))
      .groupBy('bucket')
      .addGroupBy('e."rule"')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; rule: string; xp: string }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      rule: r.rule,
      xp: Number(r.xp) || 0,
    }));
  }

  /** Roleplay minutes per bucket within [start, end). */
  async getMinutesByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<RoleplayMinutesBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', d."date"), 'YYYY-MM-DD')`,
        'bucket',
      )
      // decimal(10,2) comes back from pg as a string; the cast plus Number()
      // below keeps it a number either way.
      .addSelect('COALESCE(SUM(d."minutesPlayed"), 0)::float', 'minutes')
      .from('user_daily_scores', 'd')
      .where('d."date" >= :start', { start })
      .andWhere('d."date" < :end', { end })
      .andWhere(excludeTestTenants('d."tenant_id"'))
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; minutes: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      minutes: Number(r.minutes) || 0,
    }));
  }
}
