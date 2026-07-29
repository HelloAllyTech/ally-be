import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';

/**
 * One roleplay-volume band, in COMPLETED ROLEPLAYS over a learner's lifetime.
 *
 * Bounds are **inclusive on both ends** — deliberately unlike
 * {@link USAGE_LEVEL_BANDS}, whose upper bound is exclusive. Minutes are
 * continuous, so "25–50" has to declare which side owns exactly 25.0; a count of
 * roleplays is discrete, and `3–5` meaning "3, 4 or 5" is the only reading a
 * reader will give it. Writing that band as `[3, 6)` in the API would be
 * technically identical and would still be misread by everyone.
 *
 * The bands partition everything from 1 upwards. Zero is NOT in this list: a
 * learner who has never completed a roleplay has no session row to count, so
 * their band can only be a residual of the population
 * ({@link RoleplayVolumeAnalyticsRepository.getLifetimeDistribution} returns the
 * population, the service derives the band).
 *
 * They are fine at the bottom and coarse at the top because that is where the
 * decisions are. "Did they come back for a second one" is the activation
 * question and gets its own bar; the difference between 30 and 40 lifetime
 * roleplays changes nothing anyone would do.
 *
 * This is the ONE place the bands are declared. The SQL builds one
 * `FILTER (WHERE ...)` aggregate per entry with bound parameters, and the API
 * echoes the list back so the admin chart's axis, colours and table columns come
 * from the server's definitions rather than a second hard-coded copy that drifts.
 */
export interface RoleplayVolumeBand {
  /** Admin-facing label, and the chart's x-axis tick. Lowest volume first. */
  label: string;
  /** Inclusive lower bound, completed roleplays. */
  minCount: number;
  /** INCLUSIVE upper bound; null for the open-ended top band. */
  maxCount: number | null;
}

export const ROLEPLAY_VOLUME_BANDS: RoleplayVolumeBand[] = [
  { label: '1', minCount: 1, maxCount: 1 },
  { label: '2', minCount: 2, maxCount: 2 },
  { label: '3–5', minCount: 3, maxCount: 5 },
  { label: '6–10', minCount: 6, maxCount: 10 },
  { label: '11–25', minCount: 11, maxCount: 25 },
  { label: '26–50', minCount: 26, maxCount: 50 },
  { label: '51+', minCount: 51, maxCount: null },
];

/**
 * Label for the residual band: learners who have never completed a roleplay.
 * Kept as the bare count so it reads as the first tick of a counting axis.
 */
export const ROLEPLAY_VOLUME_ZERO_BAND_LABEL = '0';

/**
 * Smallest learner population this distribution may be shown as PERCENTAGES for.
 *
 * Deliberately the same number as {@link MIN_COHORT_SIZE} / MIN_ORG_GROUP_SIZE /
 * MIN_USAGE_POPULATION — one floor to remember across every per-person
 * breakdown. Below it the counts still travel (a count of people is not an
 * estimate of anything and leaks nothing on its own) and the shares do not: "50%
 * of our learners have never practised" over a population of two names them.
 */
export const MIN_ROLEPLAY_VOLUME_POPULATION = MIN_COHORT_SIZE;

/** The whole distribution, in one row — see {@link ROLEPLAY_VOLUME_BANDS}. */
export interface RoleplayVolumeDistributionRow {
  /** Every learner account in scope, whether or not they ever practised. */
  registeredLearners: number;
  /** Of those, learners with >= 1 completed roleplay. */
  learnersWithAny: number;
  /** Learners per band, index-aligned with {@link ROLEPLAY_VOLUME_BANDS}. */
  learnersByBand: number[];
  /** Completed roleplays across every learner in scope. */
  totalCompleted: number;
  /**
   * Median lifetime count AMONG LEARNERS WHO HAVE COMPLETED AT LEAST ONE. Null
   * when nobody has. Excluding the zeros is the point: with a large
   * never-activated population the all-learner median is 0 for months on end,
   * which says something about activation and nothing about depth.
   */
  medianAmongActive: number | null;
}

/**
 * Lifetime distribution of completed roleplays across the learner population,
 * for the "roleplay volume" chart on the leadership Highlights tab.
 *
 * The question: of all our learners, how many have completed one roleplay, a
 * handful, or dozens — and how big is the group that has never completed any?
 * The "Completed simulations per week" bar chart says how much roleplay happened
 * and the practice-minutes line says how long it took; neither can tell you
 * whether the volume came from the whole population or from thirty enthusiasts.
 *
 * ALL-TIME by design, like cohort retention and usage levels: this endpoint takes
 * no `range`/`bucket`/`from`/`to`. A lifetime count is the quantity that answers
 * the question — over a 30-day window almost every learner lands in the "1" or
 * "2" band whatever their real depth, and the chart would report the length of
 * the window rather than anything about the learners. The card says so on its
 * face rather than accepting a filter it would ignore.
 *
 * Learner-only population, read from `user_groups` -> `groups.name` exactly as
 * {@link UsageLevelAnalyticsRepository} and {@link CohortAnalyticsRepository} do,
 * so all three cards on the tab are shares of the same denominator. Trainers and
 * admins who never open a simulation would otherwise sit in the zero band forever
 * and turn the chart into a measure of the role mix.
 *
 * "Completed roleplay" mirrors the Highlights/Overview definition exactly
 * (`eventStatus = COMPLETED`, no roomId filter) so a learner's count here
 * reconciles with the volume charts beside it. It is attributed by
 * `scenario_sessions."counselorId"` — the learner who played the session.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), counts `::int` and re-parsed defensively.
 */
@Injectable()
export class RoleplayVolumeAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The population every percentage on this chart is a share of: LEARNER-group
   * accounts.
   *
   * Kept deliberately identical to `UsageLevelAnalyticsRepository.learnersCte`
   * (including NOT filtering `deletedAt`, which matches `getNewUsersByBucket` and
   * the cohort grid) so the two distributions on the tab are over the same
   * learners. If one of them ever needs to change, both change together or the
   * cards stop being comparable.
   *
   * `$1` is always the LEARNER group name; `tenantPlaceholder` is the tenant when
   * narrowing. Both are bound parameters.
   */
  private learnersCte(tenantPlaceholder?: string): string {
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('u."tenant_id"', tenantPlaceholder)}`
      : '';
    return `
      learners AS (
        SELECT u.id AS user_id
        FROM users u
        WHERE EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = $1
              )
          AND ${excludeTestTenants('u."tenant_id"')}
          ${tenantPredicate}
      )`;
  }

  /**
   * The distribution, in one pass.
   *
   * A LEFT JOIN, not an inner one: a learner with no completed roleplay must
   * survive into `per_learner` with a count of 0, because that group is the
   * headline of this chart. An inner join would silently drop exactly the people
   * the reader is looking for and leave a flattering distribution behind.
   *
   * The count is taken per learner BEFORE the band test — "3–5 roleplays" is a
   * statement about a person, not about a session.
   *
   * Both the population and the sessions are filtered for test orgs. The learner
   * filter alone would very nearly do it; the session-side predicate keeps the
   * definition of "a completed roleplay" byte-for-byte the same as the one the
   * volume charts on the same tab use, rather than nearly the same.
   */
  async getLifetimeDistribution(
    tenantId?: string,
  ): Promise<RoleplayVolumeDistributionRow> {
    const params: unknown[] = [
      UserRole.LEARNER,
      ScenarioSessionEventStatus.COMPLETED,
    ];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    // Band bounds travel as bound parameters like everything else: the band list
    // is a module constant today, but a value interpolated "because it is ours"
    // is the habit that eventually interpolates one that is not.
    const bandColumns = ROLEPLAY_VOLUME_BANDS.map((band, i) => {
      params.push(band.minCount);
      let predicate = `p.completed >= $${params.length}`;
      if (band.maxCount !== null) {
        params.push(band.maxCount);
        predicate += ` AND p.completed <= $${params.length}`;
      }
      return `COUNT(*) FILTER (WHERE ${predicate})::int AS "band${i}"`;
    }).join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      per_learner AS (
        SELECT l.user_id, COUNT(s.id)::int AS completed
        FROM learners l
        LEFT JOIN scenario_sessions s
               ON s."counselorId" = l.user_id
              AND s."eventStatus" = $2
              AND ${excludeTestTenants('s."tenant_id"')}
        GROUP BY l.user_id
      )
      SELECT
        COUNT(*)::int                                       AS "registeredLearners",
        COUNT(*) FILTER (WHERE p.completed > 0)::int         AS "learnersWithAny",
        COALESCE(SUM(p.completed), 0)::int                   AS "totalCompleted",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY p.completed)
          FILTER (WHERE p.completed > 0)                     AS "medianAmongActive",
        ${bandColumns}
      FROM per_learner p
      `,
      params,
    );

    const row = (rows[0] ?? {}) as Record<string, unknown>;
    const median = Number(row.medianAmongActive);

    return {
      registeredLearners: Number(row.registeredLearners) || 0,
      learnersWithAny: Number(row.learnersWithAny) || 0,
      learnersByBand: ROLEPLAY_VOLUME_BANDS.map(
        (_, i) => Number(row[`band${i}`]) || 0,
      ),
      totalCompleted: Number(row.totalCompleted) || 0,
      // NULL when nobody has completed anything — not zero. A median of no
      // observations is not a median of zero.
      medianAmongActive:
        row.medianAmongActive === null ||
        row.medianAmongActive === undefined ||
        Number.isNaN(median)
          ? null
          : median,
    };
  }
}
