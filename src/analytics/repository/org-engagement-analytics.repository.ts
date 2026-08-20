import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';

/**
 * One rung of the ORG engagement ladder, in total practice minutes summed across
 * the org's learners.
 *
 * Reached, never lost, exactly like the learner ladder: the ladder reads an
 * org's lifetime total, so a quiet quarter cannot demote it. The rungs are
 * nested, so the funnel can only narrow.
 *
 * ## This ladder measures size as much as engagement
 *
 * Worth stating plainly on any surface reading it: a 500-seat org clears L4 with
 * every learner doing a token amount, while a 5-seat org practising hard may
 * never leave L1. That is a real property of a total-minutes definition, chosen
 * deliberately — it answers "how much practice has this account bought us", which
 * is the number a commercial review wants. It is NOT a measure of how well an org
 * has adopted Ally per seat; the org-health tab's per-learner activity is where
 * that question is answered.
 *
 * This is the ONE place the org ladder is declared; thresholds travel into SQL as
 * bound parameters and the API echoes the list back, so labels are built from the
 * server's definition rather than a second copy that can drift.
 */
export interface OrgLadderLevel {
  /** Stable id used in the API and as a series key. */
  id: string;
  /** Admin-facing name. */
  label: string;
  /** Total org practice minutes required, inclusive. */
  minMinutes: number;
}

export const ORG_LADDER_LEVELS: OrgLadderLevel[] = [
  { id: 'L1', label: 'L1 · 500 min', minMinutes: 500 },
  { id: 'L2', label: 'L2 · 5,000 min', minMinutes: 5000 },
  { id: 'L3', label: 'L3 · 25,000 min', minMinutes: 25000 },
  { id: 'L4', label: 'L4 · 100,000 min', minMinutes: 100000 },
];

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

/** Orgs at or past each rung, plus the population they came from. */
export interface OrgLadderFunnelRow {
  /** Every non-test, non-deleted org — the funnel's top row. */
  orgs: number;
  /** Orgs at or past each rung, index-aligned with the ladder. */
  atLevel: number[];
}

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
 * Org-level engagement: how far up the ladder each account has climbed, and how
 * many accounts are still alive.
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

  /**
   * Orgs at or past each rung of the ladder, by lifetime total practice minutes.
   *
   * `LEFT JOIN` twice on purpose: an org with no learners, and an org whose
   * learners never practised, both belong in the funnel's top row rather than
   * outside the population — they are precisely the drop-off the first step
   * measures. Excluding them would flatter every conversion below it.
   *
   * Minutes come from `user_daily_scores` via the org's LEARNER accounts, the
   * same source as every learner-side chart, so an org's total is the sum of the
   * minutes its learners are individually credited with. Admin accounts are
   * excluded: minutes racked up QA-ing a scenario are not the org's practice.
   */
  async getFunnel(): Promise<OrgLadderFunnelRow> {
    const params: unknown[] = [UserRole.LEARNER];

    const levelColumns = ORG_LADDER_LEVELS.map((level, i) => {
      params.push(level.minMinutes);
      return (
        `COUNT(*) FILTER (WHERE o.minutes >= $${params.length})::int ` +
        `AS "level${i}"`
      );
    }).join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte},
      learners AS (
        SELECT u.id AS user_id, o.id AS org_id
        FROM orgs o
        JOIN users u
          ON (u."tenant_id" = o.id::text OR u."tenant_id" = o.code)
        WHERE EXISTS (
          SELECT 1 FROM user_groups ug
          JOIN groups g ON g.id = ug."groupId"
          WHERE ug."userId" = u.id AND g.name = $1
        )
      ),
      org_minutes AS (
        SELECT o.id                                 AS org_id,
               COALESCE(SUM(d."minutesPlayed"), 0)  AS minutes
        FROM orgs o
        LEFT JOIN learners l ON l.org_id = o.id
        LEFT JOIN user_daily_scores d ON d."userId" = l.user_id
        GROUP BY o.id
      )
      SELECT COUNT(*)::int AS "orgs",
        ${levelColumns}
      FROM org_minutes o
      `,
      params,
    );

    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      orgs: Number(r.orgs) || 0,
      atLevel: ORG_LADDER_LEVELS.map((_, i) => Number(r[`level${i}`]) || 0),
    };
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
