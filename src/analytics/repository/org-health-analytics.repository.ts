import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/** One org's all-time and trailing-window activity, plus its credit roll-up. */
export interface OrgHealthRow {
  tenantId: string;
  tenantName: string;
  code: string | null;
  learners: number;
  activeLearners28d: number;
  completedSimulations: number;
  completedLast28d: number;
  completedPrev28d: number;
  /** Most recent completion, or null for an org that has never had one. */
  lastCompletedAt: Date | null;
  creditLimit: number;
  consumedCredits: number;
  /**
   * Learners in the org with a NON-ZERO credit limit. Drives `creditsUnset`:
   * summing the limits cannot tell "nobody is capped" apart from "everybody is
   * capped at zero", and those are opposite operational states.
   */
  learnersWithCreditLimit: number;
}

/** One (org, ISO week) cell of the sparkline grid. */
export interface OrgHealthTrendRow {
  tenantId: string;
  /** ISO week start, `yyyy-mm-dd`. */
  bucket: string;
  count: number;
}

/**
 * Weeks of trailing history every org's sparkline covers.
 *
 * Twelve is a quarter: long enough that a fortnight's holiday does not read as
 * churn, short enough that a fading account is still visible at the right-hand
 * end. Fixed rather than driven by a window picker, because the sparkline's job is
 * to be comparable DOWN the column — twelve rows of twelve weeks each, on one
 * axis.
 */
export const ORG_HEALTH_TREND_WEEKS = 12;

/** Length of the recency comparison, in days. See {@link OrgHealthOrgDto}. */
export const ORG_HEALTH_ACTIVITY_DAYS = 28;

/**
 * Per-org health for the account-management agenda — "which customers are fading,
 * which are near their ceiling?".
 *
 * The Highlights tab's `topOrgs` answers the opposite question: it ranks the
 * biggest orgs in a window, which is a list of the accounts already doing well.
 * Nobody needs an intervention list of their happiest customers. This endpoint
 * therefore returns EVERY org in scope, with its all-time relationship, the last
 * four weeks against the four before, and how long it has been quiet — and the
 * service sorts it so the longest silences come first.
 *
 * Two definitional choices worth stating, because a reader will otherwise assume
 * something else:
 *
 *  - **28 days, not "last month".** Comparing a calendar month against the one
 *    before compares periods of different length that contain different numbers of
 *    weekdays; the resulting delta is partly an artefact of the calendar. Two equal
 *    28-day periods are two of the same thing.
 *  - **Credits are a roll-up, not a plan.** `simulation_credits` is PER USER (one
 *    unique row each), so there is no org-level ceiling stored anywhere. The org
 *    figure is `SUM` over the org's LEARNERS specifically: credits are spent by
 *    learners playing simulations, and an admin's stray row would inflate the
 *    ceiling of an org whose learners are actually at their limit.
 *
 * Test orgs and soft-deleted tenants are excluded, through the shared
 * {@link excludeTestTenants} predicate applied to `tenants.id` itself as well as to
 * every activity table — the same reason the sibling repositories filter both
 * sides: it keeps "a completed simulation" byte-for-byte the same definition here
 * as on the volume charts rather than nearly the same.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables BY
 * NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively in JS.
 */
@Injectable()
export class OrgHealthAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The org population every row of this surface is drawn from: live, non-test
   * tenants, optionally narrowed to one.
   *
   * `tenants.id` is a real uuid, so the dual-key (uuid-or-code) matching that the
   * shared predicates exist for is redundant here — they are used anyway so that
   * "whose data counts?" has exactly one answer in the codebase, and so a future
   * change to the test-org rule reaches this query too.
   */
  private orgsCte(tenantPlaceholder?: string): string {
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('t.id', tenantPlaceholder)}`
      : '';
    return `
      orgs AS (
        SELECT t.id, t.name, t.code
        FROM tenants t
        WHERE t."deletedAt" IS NULL
          AND ${excludeTestTenants('t.id')}
          ${tenantPredicate}
      )`;
  }

  /**
   * `scenario_sessions.tenant_id` is a VARCHAR holding a tenant uuid in real
   * environments and a tenant CODE (e.g. 'ally') in seed data, so both keys are
   * tried — the uuid side cast to text, because casting the varchar to uuid throws
   * on a code value. Same story for `users.tenant_id`.
   */
  private tenantJoin(column: string): string {
    return `(${column} = o.id::text OR ${column} = o.code)`;
  }

  /**
   * Every org in scope with its counts, in one pass.
   *
   * LEFT JOINs throughout: an org with no learners, no sessions and no credit rows
   * must still come back. Those are precisely the accounts this table exists to
   * surface, and an inner join would produce a healthy-looking list by deleting the
   * unhealthy rows.
   *
   * `lastCompletedAt` is `MAX(COALESCE(endedAt, createdAt))` over completed
   * sessions — the same timestamp the volume charts bucket on, so "quiet since
   * March" here and a flat line there are the same fact.
   */
  async getOrgRows(
    last28Start: Date,
    prev28Start: Date,
    tenantId?: string,
  ): Promise<OrgHealthRow[]> {
    const params: unknown[] = [
      ScenarioSessionEventStatus.COMPLETED,
      last28Start,
      prev28Start,
      UserRole.LEARNER,
    ];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte(tenantPlaceholder)},
      learners AS (
        SELECT o.id AS tenant_id, u.id AS user_id
        FROM orgs o
        JOIN users u ON ${this.tenantJoin('u."tenant_id"')}
        WHERE EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = $4
              )
          AND ${excludeTestTenants('u."tenant_id"')}
      ),
      learner_counts AS (
        SELECT tenant_id, COUNT(*)::int AS learners
        FROM learners GROUP BY tenant_id
      ),
      credits AS (
        SELECT
          l.tenant_id,
          COALESCE(SUM(sc."creditLimit"), 0)::int          AS credit_limit,
          COALESCE(SUM(sc."consumedCredits"), 0)::int      AS consumed_credits,
          COUNT(*) FILTER (WHERE sc."creditLimit" > 0)::int AS learners_with_limit
        FROM learners l
        JOIN simulation_credits sc ON sc."userId" = l.user_id
        GROUP BY l.tenant_id
      ),
      sessions AS (
        SELECT
          o.id AS tenant_id,
          s."counselorId" AS user_id,
          COALESCE(s."endedAt", s."createdAt") AS at
        FROM orgs o
        JOIN scenario_sessions s ON ${this.tenantJoin('s."tenant_id"')}
        WHERE s."eventStatus" = $1
          AND ${countableSessionPredicate('s')}
          AND ${excludeTestTenants('s."tenant_id"')}
      ),
      activity AS (
        SELECT
          tenant_id,
          COUNT(*)::int                                      AS completed,
          COUNT(*) FILTER (WHERE at >= $2)::int              AS completed_28,
          COUNT(*) FILTER (WHERE at >= $3 AND at < $2)::int  AS completed_prev_28,
          COUNT(DISTINCT user_id) FILTER (WHERE at >= $2)::int AS active_learners_28,
          MAX(at)                                            AS last_at
        FROM sessions GROUP BY tenant_id
      )
      SELECT
        o.id::text                             AS "tenantId",
        o.name                                 AS "tenantName",
        o.code                                 AS "code",
        COALESCE(lc.learners, 0)               AS "learners",
        COALESCE(a.active_learners_28, 0)      AS "activeLearners28d",
        COALESCE(a.completed, 0)               AS "completedSimulations",
        COALESCE(a.completed_28, 0)            AS "completedLast28d",
        COALESCE(a.completed_prev_28, 0)       AS "completedPrev28d",
        a.last_at                              AS "lastCompletedAt",
        COALESCE(c.credit_limit, 0)            AS "creditLimit",
        COALESCE(c.consumed_credits, 0)        AS "consumedCredits",
        COALESCE(c.learners_with_limit, 0)     AS "learnersWithCreditLimit"
      FROM orgs o
      LEFT JOIN learner_counts lc ON lc.tenant_id = o.id
      LEFT JOIN activity a       ON a.tenant_id = o.id
      LEFT JOIN credits c        ON c.tenant_id = o.id
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      tenantId: String(r.tenantId),
      tenantName: String(r.tenantName ?? r.tenantId),
      code: (r.code as string | null) ?? null,
      learners: Number(r.learners) || 0,
      activeLearners28d: Number(r.activeLearners28d) || 0,
      completedSimulations: Number(r.completedSimulations) || 0,
      completedLast28d: Number(r.completedLast28d) || 0,
      completedPrev28d: Number(r.completedPrev28d) || 0,
      lastCompletedAt: toDate(r.lastCompletedAt),
      creditLimit: Number(r.creditLimit) || 0,
      consumedCredits: Number(r.consumedCredits) || 0,
      learnersWithCreditLimit: Number(r.learnersWithCreditLimit) || 0,
    }));
  }

  /**
   * Completed simulations per (org, ISO week) over [start, end) — the sparkline
   * grid.
   *
   * Sparse: only weeks with activity come back, and the service densifies against
   * the shared axis. Densifying here would mean sending one row per org per week
   * whether or not anything happened in it.
   *
   * `date_trunc('week')` is Postgres's ISO week (Monday), which is what
   * `startOfUtcWeekMonday` generates in JS, so the keys line up regardless of the
   * Node timezone.
   */
  async getWeeklyTrend(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<OrgHealthTrendRow[]> {
    const params: unknown[] = [
      ScenarioSessionEventStatus.COMPLETED,
      start,
      end,
    ];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte(tenantPlaceholder)}
      SELECT
        o.id::text AS "tenantId",
        to_char(date_trunc('week', COALESCE(s."endedAt", s."createdAt")),
                'YYYY-MM-DD') AS "bucket",
        COUNT(*)::int AS "count"
      FROM orgs o
      JOIN scenario_sessions s ON ${this.tenantJoin('s."tenant_id"')}
      WHERE s."eventStatus" = $1
        AND COALESCE(s."endedAt", s."createdAt") >= $2
        AND COALESCE(s."endedAt", s."createdAt") < $3
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
      GROUP BY o.id, "bucket"
      ORDER BY o.id, "bucket" ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      tenantId: String(r.tenantId),
      bucket: String(r.bucket),
      count: Number(r.count) || 0,
    }));
  }
}

/** pg returns a Date for timestamps, a string under some drivers, null for none. */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
