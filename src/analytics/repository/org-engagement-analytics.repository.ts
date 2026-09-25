import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';

/**
 * Trailing windows the "orgs active recently" headline may be read over.
 *
 * 28 rather than 30 as the default, matching `ORG_HEALTH_ACTIVITY_DAYS`: four
 * whole weeks contain the same number of weekdays every time they are measured,
 * so two consecutive readings are two of the same thing rather than partly an
 * artefact of which weekend fell inside them.
 */
export const ORG_ACTIVITY_WINDOWS = [7, 28, 90] as const;
export type OrgActivityWindow = (typeof ORG_ACTIVITY_WINDOWS)[number];
export const DEFAULT_ORG_ACTIVITY_WINDOW: OrgActivityWindow = 28;

/** Complete calendar months of org-activity history the trend covers. */
export const ORG_ACTIVITY_MONTHS = 12;

/** Orgs active in one trailing window, against the orgs that existed for it. */
export interface OrgActivityWindowRow {
  activeOrgs: number;
  totalOrgs: number;
}

/** One month of the org-activity trend. */
export interface OrgActivityMonthRow {
  /** First day of the calendar month, `yyyy-mm-dd`. */
  month: string;
  /** Orgs with >=1 completed simulation IN that calendar month. */
  activeOrgs: number;
  /** Orgs that existed by the end of that month — the denominator. */
  totalOrgs: number;
}

/**
 * Org-level engagement: how many accounts there are, and how many are still
 * alive.
 *
 * ## Platform-wide by construction
 *
 * Every figure here is a count OF orgs, so a tenant filter cannot narrow it to
 * anything meaningful — "1 of 1 orgs is active" is not a fact anybody needs. The
 * service therefore ignores `tenantId` for this endpoint and names the sections
 * in `scoping.unscopedSections`, the same contract the AI-cost panels already
 * use, rather than silently returning platform numbers under a filter that reads
 * as if it applied.
 *
 * ## What "active" means
 *
 * At least one COMPLETED simulation in the window — the same definition as the
 * tab's completed-simulations and top-orgs panels, through the same shared
 * predicates. An org whose learners logged in and browsed is not active; the
 * product is practice.
 *
 * ## Test orgs
 *
 * Excluded on the tenants row itself (`isTestOrganization`) rather than through
 * the usual per-table predicate, because here the tenants table IS the
 * population. Soft-deleted orgs are excluded too: a closed account is not an org
 * that failed to be active, and leaving them in would make the active share fall
 * every time an account was tidied up.
 *
 * ## Conventions
 *
 * Raw SQL over tables BY NAME, quoted camelCase identifiers (only `tenant_id` is
 * snake_case), dates out as `yyyy-mm-dd`, counts `::int` and re-parsed
 * defensively. `scenario_sessions.tenant_id` is a VARCHAR holding either a tenant
 * uuid or a tenant CODE, so every join to it casts the uuid side to text and
 * tries both keys — casting the varchar to uuid throws on code values.
 */
@Injectable()
export class OrgEngagementAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Non-test, non-deleted orgs — the population every figure here is drawn from. */
  private readonly orgsCte = `
      orgs AS (
        SELECT t.id, t.code, t."createdAt"
        FROM tenants t
        WHERE t."isTestOrganization" = false
          AND t."deletedAt" IS NULL
      )`;

  /** Every non-test, non-deleted org — the population every figure here is drawn from. */
  async getOrgCount(): Promise<number> {
    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte}
      SELECT COUNT(*)::int AS "orgs" FROM orgs
      `,
    );

    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return Number(r.orgs) || 0;
  }

  /**
   * Orgs active in the trailing `days`, and the orgs that existed to be active.
   *
   * The denominator counts orgs created BEFORE the window opened, not all orgs
   * alive today. An account signed up three days ago has not had the chance to
   * be inactive for 28, and counting it as a miss would make the active share
   * fall every time sales closed a deal.
   */
  async getActivityWindow(days: number): Promise<OrgActivityWindowRow> {
    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte},
      window_bounds AS (
        SELECT (now() - ($1::int * interval '1 day')) AS opened
      ),
      eligible AS (
        SELECT o.id, o.code
        FROM orgs o, window_bounds w
        WHERE o."createdAt" < w.opened
      ),
      active AS (
        SELECT DISTINCT e.id
        FROM eligible e
        CROSS JOIN window_bounds w
        JOIN scenario_sessions s
          ON (s."tenant_id" = e.id::text OR s."tenant_id" = e.code)
        WHERE s."eventStatus" = $2
          AND COALESCE(s."endedAt", s."createdAt") >= w.opened
          AND ${countableSessionPredicate('s')}
      )
      SELECT (SELECT COUNT(*)::int FROM eligible) AS "totalOrgs",
             (SELECT COUNT(*)::int FROM active)   AS "activeOrgs"
      `,
      [days, ScenarioSessionEventStatus.COMPLETED],
    );

    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      activeOrgs: Number(r.activeOrgs) || 0,
      totalOrgs: Number(r.totalOrgs) || 0,
    };
  }

  /**
   * Orgs active per CALENDAR MONTH, with the orgs that existed by each month's
   * end.
   *
   * Calendar months, not a trailing window sampled monthly. A trailing-28-day
   * window re-measured every month would be the more precise companion to the
   * headline figure, but it costs a scan per sample point; a calendar month is one
   * pass and is the grain a reader assumes when they see a monthly axis. The two
   * therefore answer slightly different questions and the surface must say which
   * it is showing — the headline is "in the last X days", this trend is "in that
   * month".
   *
   * The axis is built by the service; months with no activity are absent here and
   * come back as real zeros, because "no org practised that month" is a fact.
   */
  async getActivityByMonth(months: number): Promise<OrgActivityMonthRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte},
      axis AS (
        SELECT generate_series(
          date_trunc('month', now()) - ($1::int - 1) * interval '1 month',
          date_trunc('month', now()),
          interval '1 month'
        )::date AS month
      ),
      monthly_active AS (
        SELECT date_trunc('month', COALESCE(s."endedAt", s."createdAt"))::date
                 AS month,
               o.id AS org_id
        FROM orgs o
        JOIN scenario_sessions s
          ON (s."tenant_id" = o.id::text OR s."tenant_id" = o.code)
        WHERE s."eventStatus" = $2
          AND ${countableSessionPredicate('s')}
        GROUP BY 1, 2
      )
      SELECT to_char(a.month, 'YYYY-MM-DD') AS "month",
             (
               SELECT COUNT(*)::int FROM monthly_active m
               WHERE m.month = a.month
             ) AS "activeOrgs",
             (
               SELECT COUNT(*)::int FROM orgs o
               WHERE o."createdAt" < a.month + interval '1 month'
             ) AS "totalOrgs"
      FROM axis a
      ORDER BY a.month ASC
      `,
      [months, ScenarioSessionEventStatus.COMPLETED],
    );

    return rows.map((r: Record<string, unknown>) => ({
      month: r.month as string,
      activeOrgs: Number(r.activeOrgs) || 0,
      totalOrgs: Number(r.totalOrgs) || 0,
    }));
  }
}
