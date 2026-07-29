import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/** Scribe's reach in one bucket (or, for the whole-window row, in the window). */
export interface ScribeAdoptionRow {
  /** Bucket start `yyyy-mm-dd`; the empty string for the whole-window row. */
  bucket: string;
  /** Distinct tenants with >= 1 session. */
  orgs: number;
  /** Distinct non-null `counselorId`s. */
  counsellors: number;
  sessions: number;
}

/**
 * Scribe adoption — "is the second value stream growing beyond pilots?" — for the
 * leadership Highlights tab.
 *
 * The question is BREADTH: how many customer orgs, and how many counsellors inside
 * them, actually use Scribe, and is that number going up. The Scribe tab already
 * owns the operational view (summary-failure funnels, provider reliability, phase
 * drop-off) and none of it is duplicated here — an adoption curve and a failure
 * curve on one card invites the reader to explain the first with the second, which
 * is a causal claim neither one supports.
 *
 * Definitional choices:
 *  - **Bucketed on `COALESCE(startedAt, createdAt)`** — when the counsellor
 *    actually took the call, falling back to the row's creation for sessions that
 *    never recorded a start. `createdAt` alone would attribute a backfilled or
 *    late-imported session to the month it was imported in.
 *  - **Archived chats excluded (`archivedAt IS NULL`).** Archiving is how an org
 *    removes a session from its own record — a deliberate act by the customer. An
 *    adoption figure that counts sessions the customer has retracted claims usage
 *    they have explicitly withdrawn, and the count would also silently drift
 *    downwards as orgs tidied up, which reads as churn.
 *  - **`counsellors` counts non-null `counselorId` only.** `chats.counselorId` is
 *    nullable; a session with nobody attributed is real usage (it stays in
 *    `sessions`) but it cannot be counted as a person without inventing one.
 *
 * Distinct counts are measured per bucket AND over the whole window, never summed:
 * an org that used Scribe in March and again in June is one org over the window and
 * two org-months on the chart.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables BY
 * NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), truncated dates out as `yyyy-mm-dd` strings, counts `::int` and
 * re-parsed defensively in JS.
 */
@Injectable()
export class ScribeAdoptionAnalyticsRepository {
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
   * Where the platform's data begins — the left edge of `range=all`.
   *
   * The shared platform floor (first user / first session), not the first Scribe
   * chat. That does prepend the months before Scribe shipped as zeros, and that is
   * the point: a zero month is a real measurement of adoption, and starting this
   * axis somewhere the other all-time charts do not start would make the tab's
   * cards silently non-comparable.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /** Per-bucket reach. */
  async getAdoptionByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<ScribeAdoptionRow[]> {
    return this.queryAdoption(start, end, this.resolveBucket(bucket), tenantId);
  }

  /**
   * The same measurements over the whole window, in one row.
   *
   * Its own pass, because `COUNT(DISTINCT ...)` cannot be folded up from the
   * buckets — summing per-bucket org counts would count a returning customer once
   * per month they appeared and report far more customers than exist.
   */
  async getTotals(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<ScribeAdoptionRow> {
    const rows = await this.queryAdoption(start, end, null, tenantId);
    return rows[0] ?? { bucket: '', orgs: 0, counsellors: 0, sessions: 0 };
  }

  /**
   * One SQL for both the trend and the total: `trunc` null collapses the axis to a
   * single row keyed on the empty string, so the two figures cannot end up over
   * different definitions of a Scribe session.
   */
  private async queryAdoption(
    start: Date,
    end: Date,
    trunc: AnalyticsBucket | null,
    tenantId?: string,
  ): Promise<ScribeAdoptionRow[]> {
    const params: unknown[] = [start, end];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant(
        'c."tenant_id"',
        `$${params.length}`,
      )}`;
    }

    const at = `COALESCE(c."startedAt", c."createdAt")`;
    const bucketExpr = trunc
      ? `to_char(date_trunc('${trunc}', ${at}), 'YYYY-MM-DD')`
      : `''::text`;

    const rows = await this.dataSource.query(
      `
      SELECT
        ${bucketExpr}                              AS "bucket",
        COUNT(DISTINCT c."tenant_id")::int         AS "orgs",
        COUNT(DISTINCT c."counselorId")::int       AS "counsellors",
        COUNT(*)::int                              AS "sessions"
      FROM chats c
      WHERE ${at} >= $1
        AND ${at} < $2
        AND c."archivedAt" IS NULL
        AND ${excludeTestTenants('c."tenant_id"')}
        ${tenantPredicate}
      GROUP BY "bucket"
      ORDER BY "bucket" ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      bucket: String(r.bucket ?? ''),
      orgs: Number(r.orgs) || 0,
      // COUNT(DISTINCT ...) skips NULLs, which is exactly the wanted behaviour
      // for the nullable counselorId — see the class doc comment.
      counsellors: Number(r.counsellors) || 0,
      sessions: Number(r.sessions) || 0,
    }));
  }
}
