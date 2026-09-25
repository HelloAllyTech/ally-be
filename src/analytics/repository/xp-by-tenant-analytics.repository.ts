import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { excludeTestTenants } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { resolveSqlBucket } from '../util/analytics-window.util';
import { AnalyticsBucket } from './platform-analytics.repository';

const BUCKETS: readonly AnalyticsBucket[] = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
];

/** How many named tenant segments a single bar keeps before rolling the rest up. */
export const XP_BY_TENANT_MAX_SEGMENTS = 8;

/** One tenant's XP total within the requested trailing window. */
export interface XpByTenantRow {
  tenantId: string;
  tenantName: string;
  xp: number;
}

/** One tenant's XP within one period of the window. */
export interface XpByTenantPeriodRow {
  /** `date_trunc` bucket start, yyyy-mm-dd. */
  periodStart: string;
  tenantId: string;
  xp: number;
}

/**
 * Total XP earned per tenant within a trailing window — the data behind a
 * single stacked/segmented bar, not a time series.
 *
 * `orgs` CTE mirrors `OrgHealthAnalyticsRepository`'s: live (`deletedAt IS
 * NULL`), non-test tenants. Joined to `xp_events.tenant_id` on the dual
 * uuid-or-code key that VARCHAR column holds in seed data (`t.id::text` or
 * `t.code`) — same reasoning as `excludeTestTenants`'s own dual-key match:
 * casting the varchar straight to uuid throws on a code row like `'ally'`.
 *
 * Tenants with zero XP in the window are simply absent from the result — the
 * service caps the list to the top N by XP and rolls everyone else into an
 * "Other tenants" total, so a long tail of zero-XP orgs would only be dropped
 * by that cap anyway.
 */
@Injectable()
export class XpByTenantAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Where the platform's data begins — reused for `window=all` rather than a
   * bespoke floor, matching every other all-time chart on this tab so the axes
   * agree.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Every non-test tenant's XP per `bucket` period within [start, end). Only
   * non-zero (period, tenant) pairs come back; the service zero-fills.
   * `bucket` is whitelisted before it reaches the interpolated `date_trunc`.
   */
  async getXpByTenantByPeriod(
    bucket: AnalyticsBucket,
    start: Date,
    end: Date,
  ): Promise<XpByTenantPeriodRow[]> {
    const safeBucket = resolveSqlBucket(bucket, BUCKETS, 'month');
    const rows = await this.dataSource.query(
      `
      WITH orgs AS (
        SELECT t.id, t.code
        FROM tenants t
        WHERE t."deletedAt" IS NULL
          AND ${excludeTestTenants('t.id')}
      )
      SELECT to_char(date_trunc('${safeBucket}', e."awardedOn"::timestamp), 'YYYY-MM-DD') AS "periodStart",
             o.id                                                            AS "tenantId",
             COALESCE(SUM(e."xp"), 0)::bigint                                AS "xp"
      FROM orgs o
      JOIN xp_events e
        ON (e."tenant_id" = o.id::text OR e."tenant_id" = o.code)
      WHERE e."awardedOn" >= $1
        AND e."awardedOn" < $2
      GROUP BY 1, o.id
      HAVING COALESCE(SUM(e."xp"), 0) > 0
      ORDER BY 1
      `,
      [start, end],
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      periodStart: r.periodStart as string,
      tenantId: r.tenantId as string,
      xp: Number(r.xp) || 0,
    }));
  }

  /** Every non-test tenant's XP total within [start, end), highest XP first. */
  async getXpByTenant(start: Date, end: Date): Promise<XpByTenantRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH orgs AS (
        SELECT t.id, t.name, t.code
        FROM tenants t
        WHERE t."deletedAt" IS NULL
          AND ${excludeTestTenants('t.id')}
      )
      SELECT o.id                              AS "tenantId",
             o.name                             AS "tenantName",
             COALESCE(SUM(e."xp"), 0)::bigint   AS "xp"
      FROM orgs o
      JOIN xp_events e
        ON (e."tenant_id" = o.id::text OR e."tenant_id" = o.code)
      WHERE e."awardedOn" >= $1
        AND e."awardedOn" < $2
      GROUP BY o.id, o.name
      HAVING COALESCE(SUM(e."xp"), 0) > 0
      ORDER BY "xp" DESC
      `,
      [start, end],
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      tenantId: r.tenantId as string,
      tenantName: r.tenantName as string,
      xp: Number(r.xp) || 0,
    }));
  }
}
