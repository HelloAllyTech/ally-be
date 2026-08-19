import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * One Ally Certification level, defined purely by LIFETIME roleplay minutes.
 *
 * A level is earned, never granted and never lost: the moment a learner's
 * running total of practice minutes reaches `minMinutes` they hold it forever.
 * That is what makes the cumulative line on the chart monotonic, and it is the
 * reason nothing is persisted — the certification is a *reading* of the activity
 * table, so a level added or re-cut here restates history correctly the next
 * time the endpoint is called rather than leaving a table of stale awards.
 *
 * This is the ONE place the levels are declared. The SQL takes the threshold as
 * a bound parameter and the API echoes the list back, so the chart's legend,
 * caption and table are built from the server's definition rather than a second
 * hard-coded copy that can drift.
 *
 * L1 is the only level today. The list exists so L2/L3 are one entry each —
 * every consumer already iterates it.
 */
export interface CertificationLevel {
  /** Stable id used in the API and as a series key. */
  id: string;
  /** Admin-facing name. */
  label: string;
  /** Lifetime roleplay minutes required, inclusive. */
  minMinutes: number;
}

export const CERTIFICATION_LEVELS: CertificationLevel[] = [
  { id: 'L1', label: 'L1 Ally Certified', minMinutes: 5000 },
];

/** The level this endpoint reports on. */
export const PRIMARY_CERTIFICATION_LEVEL = CERTIFICATION_LEVELS[0];

/**
 * Where the not-yet-certified learners stand, as FRACTIONS of the level's
 * threshold rather than absolute minutes.
 *
 * Fractions and not a hard-coded minute list because the pipeline has to keep
 * meaning the same thing if the threshold ever moves: "three quarters of the way
 * to L1" is the fact worth reporting, and a band list written as `3750-5000`
 * silently becomes nonsense the day L1 is re-cut. The service turns these into
 * minute bounds and labels once, and the API echoes both.
 *
 * Boundaries are lower-inclusive, upper-exclusive; the last band ends at the
 * threshold itself, above which a learner is certified rather than in the
 * pipeline.
 */
export const CERTIFICATION_PIPELINE_FRACTIONS = [0, 0.1, 0.3, 0.6, 0.9, 1];

/**
 * Fewest complete months the chart's axis spans, even when certifications
 * started later than that (or have not started at all).
 *
 * A cumulative curve with two points on it is a pair of dots, not a trend, and
 * an axis that begins at the first certification hides how long the platform ran
 * before anyone got there. Twelve months is the same span the usage-levels chart
 * uses, so the two read on the same time scale.
 */
export const CERTIFICATION_MIN_MONTHS = 12;

/** Learners newly reaching the level in a given month. */
export interface CertificationMonthRow {
  /** First day of the calendar month, `yyyy-mm-01`. */
  month: string;
  /** Learners whose running total FIRST reached the threshold this month. */
  newlyCertified: number;
}

/** The learner population's standing against the level, as of now. */
export interface CertificationPipelineRow {
  /** Every learner in scope, including those who have never practised. */
  learners: number;
  /** Learners at or past the threshold. */
  certified: number;
  /** Uncertified learners per band, index-aligned with the fraction list. */
  pipelineByBand: number[];
  /** Lifetime minutes of the uncertified learner who is furthest along. */
  nearestMinutes: number;
}

/**
 * Ally Certification attainment — the platform's hero metric.
 *
 * The question: how many distinct people have put in enough roleplay practice to
 * be Ally Certified, when did each of them get there, and how many are on the
 * way? Every other engagement number on the Highlights tab is an enabler of this
 * one; a month of heavy practice matters because it moves learners toward a
 * level, not on its own account.
 *
 * ## What counts as a minute
 *
 * `user_daily_scores."minutesPlayed"`, the sanctioned roleplay-activity source.
 * It is written on `SCENARIO_SESSION_ENDED` as `callDuration / 1000 / 60` — the
 * persisted call duration, already net of paused time — so it covers roleplay
 * only, not Scribe and not Track. Deliberately the SAME column the Highlights
 * practice-minutes chart reads, so a reader can divide the platform's total
 * practice minutes by the threshold and land near the certified count instead of
 * finding two irreconcilable definitions of a practice minute on one page.
 *
 * ## Who is eligible
 *
 * LEARNER-group accounts in non-test tenants, read from `user_groups` ->
 * `groups.name` exactly as `UsageLevelAnalyticsRepository` and
 * `CohortAnalyticsRepository` do. An admin racking up minutes while QA-ing a
 * scenario is not a certification, and letting one in would put the platform's
 * headline number at the mercy of internal testing.
 *
 * A user row is a person *within a tenant*: the same human enrolled at two orgs
 * is two accounts and can certify twice. That is the correct reading for a
 * per-tenant filter and the honest one platform-wide, since nothing in the
 * schema links the two rows.
 *
 * ## Conventions
 *
 * Follows the sibling repositories: `DataSource` raw SQL over tables BY NAME,
 * quoted camelCase identifiers (only `tenant_id` is snake_case), dates out as
 * `yyyy-mm-dd` strings, counts `::int` and re-parsed defensively.
 * `user_daily_scores."date"` is a DATE column, so `date_trunc` is pure calendar
 * maths and the keys line up with a UTC-generated axis regardless of the Node
 * process timezone.
 */
@Injectable()
export class CertificationAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The population a certification can be earned by: LEARNER-group accounts.
   *
   * `deletedAt` is deliberately NOT filtered, matching the usage-levels and
   * cohort charts, so this reconciles with the learner counts beside it rather
   * than being quietly smaller than them. A person who practised 5,000 minutes
   * and later had their account deactivated still did the practice.
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
   * The month each learner CROSSED the threshold, counted per month.
   *
   * The running total is computed in SQL with a window function over each
   * learner's monthly sums, and the certification month is the FIRST month whose
   * running total reaches the threshold. Both halves of that matter:
   *
   *  - **Running, not per-month.** The threshold is a lifetime figure. Banding a
   *    single month's minutes would ask whether anyone practised 5,000 minutes
   *    *in one month*, which is a different and much rarer event.
   *  - **First crossing, not current standing.** A learner is counted once, in
   *    the month they earned it, and never again. Counting them in every
   *    subsequent month would make the monthly bars a restatement of the
   *    cumulative line and the chart would say one thing twice.
   *
   * All-time by construction: a window param would truncate each learner's
   * history and move their crossing later, or hide it entirely. Months in which
   * nobody crossed are ABSENT — the service puts them back on the axis as real
   * zeros, because "nobody certified this month" is a fact about that month.
   *
   * `minutesPlayed` is decimal(10,2); it is only ever summed and compared inside
   * SQL here, never in JS, so no string parsing is needed on this path.
   */
  async getCertificationMonths(
    minMinutes: number,
    tenantId?: string,
  ): Promise<CertificationMonthRow[]> {
    const params: unknown[] = [UserRole.LEARNER, minMinutes];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      monthly AS (
        SELECT l.user_id,
               date_trunc('month', d."date")::date AS month,
               SUM(d."minutesPlayed")              AS minutes
        FROM learners l
        JOIN user_daily_scores d ON d."userId" = l.user_id
        GROUP BY l.user_id, month
      ),
      running AS (
        SELECT user_id,
               month,
               SUM(minutes) OVER (
                 PARTITION BY user_id
                 ORDER BY month
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS cumulative
        FROM monthly
      ),
      certified AS (
        SELECT user_id, MIN(month) AS month
        FROM running
        WHERE cumulative >= $2
        GROUP BY user_id
      )
      SELECT to_char(month, 'YYYY-MM-DD') AS "month",
             COUNT(*)::int                AS "newlyCertified"
      FROM certified
      GROUP BY month
      ORDER BY month ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      month: r.month as string,
      newlyCertified: Number(r.newlyCertified) || 0,
    }));
  }

  /**
   * Where the whole learner population stands against the threshold RIGHT NOW.
   *
   * This is the leading indicator the monthly bars cannot be: at 5,000 minutes a
   * level takes many months to earn, so a chart of crossings alone reads as a
   * flat zero for most of the time the platform is in fact succeeding. The
   * pipeline shows the wave before it lands.
   *
   * `LEFT JOIN` on purpose — a learner who has never opened a simulation has no
   * `user_daily_scores` row, and they belong in the bottom band rather than
   * outside the population. They are the denominator of "how far is the platform
   * from certifying everyone", so dropping them would flatter every share
   * computed from this.
   *
   * `nearestMinutes` is the furthest-along UNCERTIFIED learner. It names nobody
   * and answers the one question a band histogram cannot: how close is the next
   * one. When everybody in scope is already certified there is no such learner
   * and it is zero.
   */
  async getPipeline(
    minMinutes: number,
    tenantId?: string,
  ): Promise<CertificationPipelineRow> {
    const params: unknown[] = [UserRole.LEARNER, minMinutes];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    // Bounds travel as bound parameters like everything else: the fractions are
    // a module constant today, but a value interpolated "because it is ours" is
    // the habit that eventually interpolates one that is not.
    const bandColumns = CERTIFICATION_PIPELINE_FRACTIONS.slice(0, -1)
      .map((fraction, i) => {
        const upperFraction = CERTIFICATION_PIPELINE_FRACTIONS[i + 1];
        params.push(fraction * minMinutes);
        const min = `$${params.length}`;
        params.push(upperFraction * minMinutes);
        const max = `$${params.length}`;
        return (
          `COUNT(*) FILTER (WHERE t.minutes >= ${min} ` +
          `AND t.minutes < ${max})::int AS "band${i}"`
        );
      })
      .join(',\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      totals AS (
        SELECT l.user_id,
               COALESCE(SUM(d."minutesPlayed"), 0) AS minutes
        FROM learners l
        LEFT JOIN user_daily_scores d ON d."userId" = l.user_id
        GROUP BY l.user_id
      )
      SELECT
        COUNT(*)::int                                  AS "learners",
        COUNT(*) FILTER (WHERE t.minutes >= $2)::int   AS "certified",
        ${bandColumns},
        COALESCE(MAX(t.minutes) FILTER (WHERE t.minutes < $2), 0)::float
                                                       AS "nearestMinutes"
      FROM totals t
      `,
      params,
    );

    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      learners: Number(r.learners) || 0,
      certified: Number(r.certified) || 0,
      pipelineByBand: CERTIFICATION_PIPELINE_FRACTIONS.slice(0, -1).map(
        (_, i) => Number(r[`band${i}`]) || 0,
      ),
      nearestMinutes: Number(r.nearestMinutes) || 0,
    };
  }

  /**
   * The first month any learner in scope practised at all.
   *
   * Used only to decide where the axis starts. Without it a platform whose first
   * certification landed last month would draw a two-point chart, and a reader
   * could not tell whether that was a sudden success or the end of a long climb.
   * Null when nobody has ever practised.
   */
  async getFirstActivityMonth(tenantId?: string): Promise<string | null> {
    const params: unknown[] = [UserRole.LEARNER];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)}
      SELECT to_char(MIN(date_trunc('month', d."date")::date), 'YYYY-MM-DD')
               AS "month"
      FROM user_daily_scores d
      JOIN learners l ON l.user_id = d."userId"
      WHERE d."minutesPlayed" > 0
      `,
      params,
    );

    const month = (rows[0] as Record<string, unknown> | undefined)?.month;
    return typeof month === 'string' ? month : null;
  }
}
