import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * The "active user" definitions the cohort chart offers, in MINUTES of
 * simulation practice within a calendar month. Ordered loosest -> strictest so
 * the retention curves nest: anyone clearing 100 also clears 50 and 10.
 *
 * This is the ONE place the thresholds are declared — the SQL builds one
 * `FILTER (WHERE ...)` aggregate per entry with a bound parameter each, and the
 * API echoes the list back so the admin dropdown is built from the server's
 * definitions rather than a second hard-coded copy.
 */
export const COHORT_ACTIVITY_THRESHOLDS = [10, 50, 100] as const;

/**
 * Smallest cohort that may be shown as a PERCENTAGE.
 *
 * A retention cell is a statement about a handful of identifiable people: with
 * a tenant filter applied, "50% of the 2 learners who joined in March" names an
 * individual to anyone who knows the org. Cohorts below the floor keep their
 * size on screen (a count is not an estimate of anything and leaks nothing on
 * its own) but their percentages are suppressed.
 *
 * Deliberately the same number as MIN_ORG_GROUP_SIZE in
 * highlights-analytics.repository — one minimum-group-size rule for the whole
 * analytics surface is one people can hold in their head.
 */
export const MIN_COHORT_SIZE = 5;

/** One cohort's headcount — the denominator every percentage in its row uses. */
export interface CohortSizeRow {
  /** First day of the signup month, `yyyy-mm-01`. */
  cohortMonth: string;
  learners: number;
}

/** One cell of the cohort triangle: cohort x months-since-signup. */
export interface CohortActivityRow {
  cohortMonth: string;
  /** Calendar month the activity happened in, `yyyy-mm-01`. */
  activityMonth: string;
  /** Whole months between the signup month and the activity month; >= 1. */
  monthIndex: number;
  /**
   * Learners of this cohort who cleared each threshold that month,
   * index-aligned with {@link COHORT_ACTIVITY_THRESHOLDS}.
   */
  activeByThreshold: number[];
}

/**
 * Monthly cohort retention for the leadership Highlights tab.
 *
 * The question: of the learners who signed up in month M, what share came back
 * and actually practised in each later month? Signup month is the cohort key;
 * "came back" is a minutes-of-practice threshold, and all three thresholds are
 * computed in the SAME pass so the admin's dropdown switches definition without
 * a refetch (and so the three can never disagree about the denominator).
 *
 * Deliberately ALL-TIME and month-grained — a retention curve is only readable
 * once it has run for several months, so this endpoint ignores the page's date
 * range rather than pretending to honour it. The card says so on its face.
 *
 * Conventions follow HighlightsAnalyticsRepository: `DataSource` raw SQL over
 * tables BY NAME (no entity repos), quoted camelCase identifiers (only
 * `tenant_id` is snake_case), dates out as `yyyy-mm-dd` strings, counts `::int`
 * and re-parsed defensively.
 *
 * Two things this deliberately does NOT do:
 *  - It does not filter `users."deletedAt"`, matching
 *    `getNewUsersByBucket` exactly, so the cohort sizes reconcile 1:1 with the
 *    "New users per period" chart on the same tab.
 *  - It does not measure month 0. The signup month is the cohort itself; the
 *    chart anchors it at 100% by definition and starts measuring at month 1.
 */
@Injectable()
export class CohortAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The cohort population: LEARNER-group accounts, keyed by signup month.
   *
   * Learner-only because the denominator has to be people who could plausibly
   * practise — an admin who never opens a simulation would drag every cohort
   * down forever and make the chart a measure of the role mix rather than of
   * retention. Membership is read from `user_groups` -> `groups.name`, the same
   * route `getUsersByRole` takes.
   *
   * `$1` is always the LEARNER group name; `$2` is the tenant when narrowing.
   */
  private learnersCte(tenantId?: string): string {
    const tenantPredicate = tenantId
      ? `AND ${scopeToTenant('u."tenant_id"', '$2')}`
      : '';
    return `
      learners AS (
        SELECT u.id                                        AS user_id,
               date_trunc('month', u."createdAt")::date    AS cohort_month
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

  /** Cohort sizes, oldest first. Months with no learner signups are absent. */
  async getCohortSizes(tenantId?: string): Promise<CohortSizeRow[]> {
    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantId)}
      SELECT to_char(cohort_month, 'YYYY-MM-DD') AS "cohortMonth",
             COUNT(*)::int                       AS learners
      FROM learners
      GROUP BY cohort_month
      ORDER BY cohort_month ASC
      `,
      tenantId ? [UserRole.LEARNER, tenantId] : [UserRole.LEARNER],
    );

    return rows.map((r: Record<string, unknown>) => ({
      cohortMonth: r.cohortMonth as string,
      learners: Number(r.learners) || 0,
    }));
  }

  /**
   * The triangle's cells: for each (cohort, month offset >= 1), how many of that
   * cohort's learners cleared each minutes threshold.
   *
   * Minutes come from `user_daily_scores."minutesPlayed"` — the sanctioned
   * activity source, already net of paused time — summed per learner per
   * calendar month, then compared to each threshold. The per-learner sum has to
   * happen BEFORE the threshold test: "50+ minutes in the month" is a statement
   * about a person's month, not about a single session.
   *
   * The `date` column is a DATE, so `date_trunc` here is pure calendar maths and
   * the resulting keys match a UTC-generated axis regardless of the Node
   * process timezone. `minutesPlayed` is decimal(10,2), which the pg driver
   * returns as a string — it is only ever compared inside SQL, never summed in
   * JS, so no parsing is needed on this path.
   */
  async getCohortActivity(tenantId?: string): Promise<CohortActivityRow[]> {
    const params: unknown[] = tenantId
      ? [UserRole.LEARNER, tenantId]
      : [UserRole.LEARNER];
    // Thresholds travel as bound parameters like everything else: the list is a
    // module constant today, but a value interpolated "because it is ours" is
    // the habit that eventually interpolates one that is not.
    const thresholdPlaceholders = COHORT_ACTIVITY_THRESHOLDS.map((t) => {
      params.push(t);
      return `$${params.length}`;
    });
    const thresholdColumns = thresholdPlaceholders
      .map(
        (p, i) =>
          `COUNT(*) FILTER (WHERE a.minutes >= ${p})::int AS "threshold${i}"`,
      )
      .join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantId)},
      activity AS (
        SELECT l.cohort_month,
               l.user_id,
               date_trunc('month', d."date")::date AS activity_month,
               SUM(d."minutesPlayed")              AS minutes
        FROM learners l
        JOIN user_daily_scores d ON d."userId" = l.user_id
        GROUP BY l.cohort_month, l.user_id, activity_month
      )
      SELECT
        to_char(a.cohort_month, 'YYYY-MM-DD')   AS "cohortMonth",
        to_char(a.activity_month, 'YYYY-MM-DD') AS "activityMonth",
        (
          (EXTRACT(YEAR FROM a.activity_month) - EXTRACT(YEAR FROM a.cohort_month)) * 12
          + (EXTRACT(MONTH FROM a.activity_month) - EXTRACT(MONTH FROM a.cohort_month))
        )::int                                  AS "monthIndex",
        ${thresholdColumns}
      FROM activity a
      WHERE a.activity_month > a.cohort_month
      GROUP BY a.cohort_month, a.activity_month
      ORDER BY a.cohort_month ASC, a.activity_month ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      cohortMonth: r.cohortMonth as string,
      activityMonth: r.activityMonth as string,
      monthIndex: Number(r.monthIndex) || 0,
      activeByThreshold: COHORT_ACTIVITY_THRESHOLDS.map(
        (_, i) => Number(r[`threshold${i}`]) || 0,
      ),
    }));
  }
}
