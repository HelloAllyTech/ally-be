import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';

/**
 * One usage level, in MINUTES of simulation practice within a calendar month.
 *
 * Bands are lower-inclusive and upper-exclusive (`[min, max)`), so a learner
 * with exactly 25.0 minutes is in "25–50" and not in "10–25". They partition
 * everything ABOVE zero and nothing below it — the "0 min" band is deliberately
 * NOT in this list, because it is a residual of the chosen denominator (see
 * {@link UsageLevelAnalyticsRepository.getMonthlyBandCounts}) rather than
 * something the activity table can be asked for: a learner who never practised
 * has no row to count.
 *
 * This is the ONE place the bands are declared. The SQL builds one
 * `FILTER (WHERE ...)` aggregate per entry with bound parameters, and the API
 * echoes the list back so the admin chart's legend, colour ramp and table
 * columns are built from the server's definitions rather than a second
 * hard-coded copy that can drift.
 */
export interface UsageLevelBand {
  /** Admin-facing label. Ordered lowest usage first. */
  label: string;
  /** Inclusive lower bound, minutes. */
  minMinutes: number;
  /** Exclusive upper bound, minutes; null for the open-ended top band. */
  maxMinutes: number | null;
}

export const USAGE_LEVEL_BANDS: UsageLevelBand[] = [
  { label: 'Under 10 min', minMinutes: 0, maxMinutes: 10 },
  { label: '10–25 min', minMinutes: 10, maxMinutes: 25 },
  { label: '25–50 min', minMinutes: 25, maxMinutes: 50 },
  { label: '50–100 min', minMinutes: 50, maxMinutes: 100 },
  { label: '100–500 min', minMinutes: 100, maxMinutes: 500 },
  { label: '500–1000 min', minMinutes: 500, maxMinutes: 1000 },
  { label: '1000+ min', minMinutes: 1000, maxMinutes: null },
];

/** Label for the residual band: learners who practised nothing that month. */
export const USAGE_LEVEL_ZERO_BAND_LABEL = '0 min';

/** Complete calendar months shown before the current, unfinished one. */
export const USAGE_LEVEL_MONTHS = 12;

/**
 * Smallest population a month's SHARES may be stated for.
 *
 * A usage-level bar is a breakdown of identifiable people: under a tenant filter,
 * "33% of learners practised 100+ minutes" over a three-learner org names someone
 * to anyone who knows the org. Below the floor the month keeps its counts (a count
 * is not an estimate of anything and leaks nothing on its own) and loses its
 * percentages.
 *
 * Deliberately the SAME number as MIN_COHORT_SIZE / MIN_ORG_GROUP_SIZE — one
 * minimum-group-size rule for the whole analytics surface is one people can hold
 * in their head — and re-exported from there rather than redeclared, so there is
 * one place to change it. The API echoes it so the client applies the server's
 * floor instead of carrying a second copy.
 */
export const MIN_USAGE_POPULATION = MIN_COHORT_SIZE;

export interface UsageLevelMonthRow {
  /** First day of the calendar month, `yyyy-mm-01`. */
  month: string;
  /** Learners in each band, index-aligned with {@link USAGE_LEVEL_BANDS}. */
  learnersByBand: number[];
  /** Learners with any practice at all that month — the bands' total. */
  activeLearners: number;
}

/** All-time count of learners keyed on a month, oldest first. */
export interface MonthlyLearnerCountRow {
  month: string;
  learners: number;
}

/**
 * Distribution of monthly practice time across the learner population, for the
 * "usage levels" chart on the leadership Highlights tab.
 *
 * The question: what share of our learners practise how much, month by month —
 * and is the mix shifting up or down? A total-minutes line answers "how much
 * practice happened" but hides whether that came from everyone doing a little or
 * a handful doing a lot; this answers the second question.
 *
 * Learner-only population, read from `user_groups` -> `groups.name` exactly as
 * `CohortAnalyticsRepository` does. An admin who never opens a simulation would
 * otherwise sit in the "0 min" band forever and turn the chart into a measure of
 * the role mix rather than of practice.
 *
 * Two denominators are returned per month, both from this repository, because
 * "percentage of users" has two defensible readings and one query pass can serve
 * both (see the DTO):
 *   - every learner account that existed by the end of the month, and
 *   - of those, the ones who had ever practised by then.
 * Neither is derivable from the other on the client, and computing them in
 * separate requests is how two definitions drift apart.
 *
 * Deliberately month-grained and fixed to the last {@link USAGE_LEVEL_MONTHS}
 * complete months plus the current one, like cohort retention: a monthly
 * distribution needs several months before a shift is visible, so this endpoint
 * ignores the page's date range rather than pretending to honour it. The card
 * says so on its face.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id` is
 * snake_case), dates out as `yyyy-mm-dd` strings, counts `::int` and re-parsed
 * defensively. `user_daily_scores."date"` is a DATE column, so `date_trunc` is
 * pure calendar maths and the keys line up with a UTC-generated axis regardless
 * of the Node process timezone.
 */
@Injectable()
export class UsageLevelAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The population every percentage on this chart is a share of: LEARNER-group
   * accounts, with their signup month.
   *
   * `deletedAt` is deliberately NOT filtered, matching `getNewUsersByBucket` and
   * the cohort grid, so this chart's denominator reconciles with the "New users
   * per period" chart on the same tab rather than being quietly smaller than it.
   *
   * `$1` is always the LEARNER group name; `tenantPlaceholder` is the tenant when
   * narrowing. Both are bound parameters — the caller owns the numbering because
   * each query needs a different set of them.
   */
  private learnersCte(tenantPlaceholder?: string): string {
    const tenantPredicate = tenantPlaceholder
      ? `AND ${scopeToTenant('u."tenant_id"', tenantPlaceholder)}`
      : '';
    return `
      learners AS (
        SELECT u.id                                     AS user_id,
               date_trunc('month', u."createdAt")::date AS signup_month
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
   * Per month in [start, end): how many learners fell in each usage band.
   *
   * Minutes come from `user_daily_scores."minutesPlayed"` — the sanctioned
   * activity source, already net of paused time — summed per learner per
   * calendar month BEFORE the band test. That order matters: "25–50 minutes in
   * the month" is a statement about a person's month, not about a session, and
   * banding per session would put a learner in three bands at once.
   *
   * Only learners with strictly positive minutes are counted here. A learner with
   * a `user_daily_scores` row summing to exactly zero is not a "under 10 min"
   * learner — nothing was practised — so they fall out of every band and land in
   * the zero band the service derives. Months with no practice at all are absent;
   * the service puts them back on the axis with real zeros, because "nobody
   * practised" is a fact.
   *
   * `minutesPlayed` is decimal(10,2); it is only ever compared inside SQL here,
   * never summed in JS, so no string parsing is needed on this path.
   */
  async getMonthlyBandCounts(
    start: Date,
    end: Date,
    tenantId?: string,
  ): Promise<UsageLevelMonthRow[]> {
    const params: unknown[] = [UserRole.LEARNER, start, end];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    // Bounds travel as bound parameters like everything else: the band list is a
    // module constant today, but a value interpolated "because it is ours" is the
    // habit that eventually interpolates one that is not.
    const bandColumns = USAGE_LEVEL_BANDS.map((band, i) => {
      params.push(band.minMinutes);
      const min = `$${params.length}`;
      let predicate = `a.minutes > 0 AND a.minutes >= ${min}`;
      if (band.maxMinutes !== null) {
        params.push(band.maxMinutes);
        predicate += ` AND a.minutes < $${params.length}`;
      }
      return `COUNT(*) FILTER (WHERE ${predicate})::int AS "band${i}"`;
    }).join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      activity AS (
        SELECT l.user_id,
               date_trunc('month', d."date")::date AS month,
               SUM(d."minutesPlayed")              AS minutes
        FROM learners l
        JOIN user_daily_scores d ON d."userId" = l.user_id
        WHERE d."date" >= $2 AND d."date" < $3
        GROUP BY l.user_id, month
      )
      SELECT
        to_char(a.month, 'YYYY-MM-DD')                     AS "month",
        COUNT(*) FILTER (WHERE a.minutes > 0)::int          AS "activeLearners",
        ${bandColumns}
      FROM activity a
      GROUP BY a.month
      ORDER BY a.month ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      month: r.month as string,
      learnersByBand: USAGE_LEVEL_BANDS.map(
        (_, i) => Number(r[`band${i}`]) || 0,
      ),
      activeLearners: Number(r.activeLearners) || 0,
    }));
  }

  /**
   * Learner signups per month, ALL TIME — the raw material for "learner accounts
   * that existed by the end of month M", which the service builds by cumulating.
   *
   * All-time rather than windowed on purpose: the denominator for January is
   * everyone who had signed up by January, most of whom signed up before the
   * chart's first month. Windowing this would silently make every early month's
   * denominator too small, which inflates exactly the share the chart is about.
   */
  async getLearnerSignupsByMonth(
    tenantId?: string,
  ): Promise<MonthlyLearnerCountRow[]> {
    const params: unknown[] = [UserRole.LEARNER];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)}
      SELECT to_char(signup_month, 'YYYY-MM-DD') AS "month",
             COUNT(*)::int                       AS "learners"
      FROM learners
      GROUP BY signup_month
      ORDER BY signup_month ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      month: r.month as string,
      learners: Number(r.learners) || 0,
    }));
  }

  /**
   * Learners keyed on the month they FIRST practised, ALL TIME — cumulated by the
   * service into "learners who had ever practised by the end of month M", the
   * second denominator.
   *
   * Why the alternative exists: with every registered learner in the denominator,
   * a platform with many signups who never started reads as one where nobody
   * practises, and the shifts among the people who DO practise become invisible
   * slivers. Both readings are legitimate and they answer different questions
   * ("are we activating people?" vs "are our active learners deepening?"), so the
   * client offers both from this one response.
   */
  async getFirstPracticeMonths(
    tenantId?: string,
  ): Promise<MonthlyLearnerCountRow[]> {
    const params: unknown[] = [UserRole.LEARNER];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      first_practice AS (
        SELECT d."userId"                                   AS user_id,
               MIN(date_trunc('month', d."date")::date)     AS month
        FROM user_daily_scores d
        JOIN learners l ON l.user_id = d."userId"
        WHERE d."minutesPlayed" > 0
        GROUP BY d."userId"
      )
      SELECT to_char(month, 'YYYY-MM-DD') AS "month",
             COUNT(*)::int                AS "learners"
      FROM first_practice
      GROUP BY month
      ORDER BY month ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      month: r.month as string,
      learners: Number(r.learners) || 0,
    }));
  }
}
