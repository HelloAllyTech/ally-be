import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * One band of an org's all-time AVERAGE minutes-played per learner.
 *
 * Bounds are lower-inclusive/upper-exclusive (`[min, max)`), matching
 * {@link https://github.com | USAGE_LEVEL_BANDS}'s convention for the same
 * reason: minutes are continuous, so a boundary value needs a declared side.
 *
 * These cut points are a first-pass guess, not a calibrated scale — nothing on
 * the platform has bucketed a per-org AVERAGE before (the existing
 * `usage-levels` bands measure one learner's minutes in one month, an order of
 * magnitude smaller than an org's lifetime-average). This is exactly what the
 * Testing tab is for: ship a reasonable guess, look at where real orgs land,
 * move the boundaries before this graduates anywhere else.
 */
export interface OrgAvgMinutesBand {
  label: string;
  minMinutes: number;
  maxMinutes: number | null;
}

export const ORG_AVG_MINUTES_BANDS: OrgAvgMinutesBand[] = [
  { label: 'Under 30 min', minMinutes: 0, maxMinutes: 30 },
  { label: '30–120 min', minMinutes: 30, maxMinutes: 120 },
  { label: '120–360 min', minMinutes: 120, maxMinutes: 360 },
  { label: '360–1000 min', minMinutes: 360, maxMinutes: 1000 },
  { label: '1000+ min', minMinutes: 1000, maxMinutes: null },
];

/**
 * One band of an org's all-time AVERAGE completed sessions per learner.
 *
 * Also lower-inclusive/upper-exclusive: unlike `ROLEPLAY_VOLUME_BANDS` (a
 * per-learner LIFETIME COUNT, genuinely discrete), an org AVERAGE is a real
 * number — 3.4 sessions/learner is a legitimate value — so integer
 * inclusive-inclusive bands would leave most orgs falling between bands
 * rather than in the deliberately-discrete "3" or "5" buckets that make sense
 * for a single learner's count.
 */
export interface OrgAvgSessionsBand {
  label: string;
  minSessions: number;
  maxSessions: number | null;
}

export const ORG_AVG_SESSIONS_BANDS: OrgAvgSessionsBand[] = [
  { label: 'Under 1', minSessions: 0, maxSessions: 1 },
  { label: '1–3', minSessions: 1, maxSessions: 3 },
  { label: '3–5', minSessions: 3, maxSessions: 5 },
  { label: '5–10', minSessions: 5, maxSessions: 10 },
  { label: '10+', minSessions: 10, maxSessions: null },
];

export interface OrgDistributionResult {
  /** Orgs with >=1 learner — the population every band count is drawn from. */
  totalOrgs: number;
  /** Orgs per band, index-aligned with the band list. */
  orgsByBand: number[];
}

/**
 * Distribution of tenants by their all-time average session time and average
 * session frequency per learner, for the Testing tab.
 *
 * This is the one candidate metric of this batch that is meaningful ONLY
 * platform-wide: "which band does this org's average fall into" is a
 * statement about how it compares to every OTHER org, so it cannot exist as a
 * per-tenant metric the way `simulationsCompleted`/`activeUsers` on the
 * tenant-admin Organization Metrics dashboard do. `org-health` already gives a
 * ranked table of raw per-org numbers; this answers a different question —
 * not "which specific orgs are struggling" but "how is the whole customer base
 * shaped".
 *
 * All-time by design, like every other Testing-tab distribution (`usage-levels`,
 * `roleplay-volume`) — an org's average over a 30-day window is dominated by
 * whichever tenants happened to onboard recently, not by how the org actually
 * behaves.
 *
 * Two different activity sources, matching the platform's own conventions for
 * each quantity:
 *   - minutes come from `user_daily_scores."minutesPlayed"`, the sanctioned
 *     practice-time source used by `usage-levels`/Highlights (already net of
 *     paused time) — not re-derived from session timestamps.
 *   - session frequency comes from counting `scenario_sessions` rows directly,
 *     matching `roleplay-volume`'s definition of a completed roleplay
 *     (`eventStatus = COMPLETED`, `countableSessionPredicate`).
 *
 * `MIN_ORG_GROUP_SIZE`-style floor: the whole distribution is suppressed by the
 * SERVICE (not here) when `totalOrgs` is below the floor, matching the
 * platform's one-floor-for-every-per-org-breakdown rule.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over
 * tables BY NAME, quoted camelCase identifiers (`tenant_id` excepted), counts
 * `::int`, bound-parameter band bounds (never interpolated literals).
 */
@Injectable()
export class OrgSessionDistributionAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Live, non-test tenants — same population `OrgHealthAnalyticsRepository` draws from. */
  private orgsCte(tenantPlaceholder?: string): string {
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('t.id', tenantPlaceholder)}`
      : '';
    return `
      orgs AS (
        SELECT t.id, t.code
        FROM tenants t
        WHERE t."deletedAt" IS NULL
          AND ${excludeTestTenants('t.id')}
          ${tenantPredicate}
      )`;
  }

  /** `users."tenant_id"` may hold a tenant uuid or a tenant CODE, so both keys are tried. */
  private tenantJoin(column: string): string {
    return `(${column} = o.id::text OR ${column} = o.code)`;
  }

  private learnersCte(): string {
    return `
      learners AS (
        SELECT o.id AS tenant_id, u.id AS user_id
        FROM orgs o
        JOIN users u ON ${this.tenantJoin('u."tenant_id"')}
        WHERE EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = $1
              )
          AND ${excludeTestTenants('u."tenant_id"')}
      )`;
  }

  /** Orgs bucketed by all-time AVERAGE minutes-played per learner. */
  async getTimeDistribution(tenantId?: string): Promise<OrgDistributionResult> {
    const params: unknown[] = [UserRole.LEARNER];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const bandColumns = ORG_AVG_MINUTES_BANDS.map((band, i) => {
      params.push(band.minMinutes);
      const min = `$${params.length}`;
      let predicate = `o_avg.avg_minutes >= ${min}`;
      if (band.maxMinutes !== null) {
        params.push(band.maxMinutes);
        predicate += ` AND o_avg.avg_minutes < $${params.length}`;
      }
      return `COUNT(*) FILTER (WHERE ${predicate})::int AS "band${i}"`;
    }).join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte(tenantPlaceholder)},
      ${this.learnersCte()},
      learner_minutes AS (
        SELECT l.tenant_id, l.user_id, COALESCE(SUM(d."minutesPlayed"), 0) AS minutes
        FROM learners l
        LEFT JOIN user_daily_scores d ON d."userId" = l.user_id
        GROUP BY l.tenant_id, l.user_id
      ),
      o_avg AS (
        SELECT tenant_id, AVG(minutes)::float AS avg_minutes
        FROM learner_minutes
        GROUP BY tenant_id
      )
      SELECT
        COUNT(*)::int AS "totalOrgs",
        ${bandColumns}
      FROM o_avg
      `,
      params,
    );

    return this.toResult(rows[0], ORG_AVG_MINUTES_BANDS.length);
  }

  /** Orgs bucketed by all-time AVERAGE completed sessions per learner. */
  async getFrequencyDistribution(
    tenantId?: string,
  ): Promise<OrgDistributionResult> {
    const params: unknown[] = [
      UserRole.LEARNER,
      ScenarioSessionEventStatus.COMPLETED,
    ];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const bandColumns = ORG_AVG_SESSIONS_BANDS.map((band, i) => {
      params.push(band.minSessions);
      const min = `$${params.length}`;
      let predicate = `o_avg.avg_sessions >= ${min}`;
      if (band.maxSessions !== null) {
        params.push(band.maxSessions);
        predicate += ` AND o_avg.avg_sessions < $${params.length}`;
      }
      return `COUNT(*) FILTER (WHERE ${predicate})::int AS "band${i}"`;
    }).join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.orgsCte(tenantPlaceholder)},
      ${this.learnersCte()},
      learner_sessions AS (
        SELECT l.tenant_id, l.user_id, COUNT(s.id)::int AS session_count
        FROM learners l
        LEFT JOIN scenario_sessions s
          ON s."counselorId" = l.user_id
          AND s."eventStatus" = $2
          AND ${countableSessionPredicate('s')}
          AND ${excludeTestTenants('s."tenant_id"')}
        GROUP BY l.tenant_id, l.user_id
      ),
      o_avg AS (
        SELECT tenant_id, AVG(session_count)::float AS avg_sessions
        FROM learner_sessions
        GROUP BY tenant_id
      )
      SELECT
        COUNT(*)::int AS "totalOrgs",
        ${bandColumns}
      FROM o_avg
      `,
      params,
    );

    return this.toResult(rows[0], ORG_AVG_SESSIONS_BANDS.length);
  }

  private toResult(
    row: Record<string, unknown> | undefined,
    bandCount: number,
  ): OrgDistributionResult {
    return {
      totalOrgs: Number(row?.totalOrgs) || 0,
      orgsByBand: Array.from(
        { length: bandCount },
        (_, i) => Number(row?.[`band${i}`]) || 0,
      ),
    };
  }
}
