import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';

/**
 * One rung of the learner usage ladder, defined purely by LIFETIME roleplay
 * minutes.
 *
 * A rung is reached, never lost: the moment a learner's running total of
 * practice minutes touches `minMinutes` they hold that level forever. That is
 * what makes the cumulative series monotonic and the funnel nested (everyone at
 * L3 is also at L2 and L1), and it is why nothing is persisted — a level is a
 * *reading* of the activity table, so re-cutting a threshold restates history
 * correctly on the next request instead of leaving a table of stale awards.
 *
 * ## Not the same scale as Ally Certification
 *
 * `CERTIFICATION_LEVELS` in the sibling repository holds ONE rung at 5,000
 * lifetime minutes, called "L1 Ally Certified". This ladder's rungs are also
 * called L1..L5 and its top rung (6,000) sits ABOVE that certification. The two
 * are deliberately separate scales measuring the same minutes for different
 * purposes — the certification is an award the learner is told about, this ladder
 * is an internal depth-of-engagement segmentation — so every surface reading this
 * must say "usage level", never "certified", and must not place the two on one
 * axis. They are kept apart in code for the same reason: one shared constant
 * would mean re-cutting an internal reporting band silently re-awarded, or
 * revoked, a learner's certification.
 *
 * This is the ONE place the ladder is declared. The SQL takes each threshold as a
 * bound parameter and the API echoes the list back, so legends, funnel labels and
 * table headers are built from the server's definition rather than a second
 * hard-coded copy that can drift.
 */
export interface UsageLadderLevel {
  /** Stable id used in the API and as a series key. */
  id: string;
  /** Admin-facing name, including the human-scale gloss. */
  label: string;
  /** Lifetime roleplay minutes required, inclusive. */
  minMinutes: number;
}

export const USAGE_LADDER_LEVELS: UsageLadderLevel[] = [
  { id: 'L1', label: 'L1 · 1 hour', minMinutes: 60 },
  { id: 'L2', label: 'L2 · 5 hours', minMinutes: 300 },
  { id: 'L3', label: 'L3 · 20 hours', minMinutes: 1200 },
  { id: 'L4', label: 'L4 · 50 hours', minMinutes: 3000 },
  { id: 'L5', label: 'L5 · 100 hours', minMinutes: 6000 },
];

/**
 * Grains the ladder may be read at.
 *
 * Month and quarter only. A ladder rung at 60 minutes takes weeks of practice to
 * reach and the top rung takes years, so a daily or weekly axis would be almost
 * entirely empty bars — the grain has to be coarser than the thing being
 * measured or the chart shows noise around a trend it cannot resolve.
 */
export const USAGE_LADDER_GRAINS = ['month', 'quarter'] as const;
export type UsageLadderGrain = (typeof USAGE_LADDER_GRAINS)[number];

/**
 * Fewest complete periods the axis spans, per grain, even when the platform's
 * history is shorter.
 *
 * A cumulative curve with two points on it is a pair of dots, not a trend. Twelve
 * months matches the usage-levels and certification charts so all three read on
 * the same time scale; eight quarters is two years, which is the shortest span in
 * which a quarterly series has a shape.
 */
export const USAGE_LADDER_MIN_PERIODS: Record<UsageLadderGrain, number> = {
  month: 12,
  quarter: 8,
};

/** Learners newly reaching each rung in one period, index-aligned with the ladder. */
export interface UsageLadderPeriodRow {
  /** First day of the period, `yyyy-mm-dd`. */
  period: string;
  /** Learners whose running total FIRST reached each rung in this period. */
  newlyReachedByLevel: number[];
}

/** The learner population's standing against the whole ladder, as of now. */
export interface UsageLadderFunnelRow {
  /** Every learner account in scope, whether or not they ever practised. */
  accounts: number;
  /** Learners at or past each rung, index-aligned with the ladder. */
  everReachedByLevel: number[];
}

/**
 * Learner progress up the usage ladder — how many people have practised how much,
 * cumulatively, and when they got there.
 *
 * Four questions off one ladder, which is why they share a repository rather than
 * sitting in four: they must agree. "Users who reached L3 this quarter", "users at
 * L3 in total", "the L1→L5 funnel" and "L3s produced per month" are four readings
 * of one definition, and computing them in separate places is how three of them
 * end up subtly disagreeing with the fourth.
 *
 * ## What counts as a minute
 *
 * `user_daily_scores."minutesPlayed"`, the sanctioned roleplay-activity source,
 * written on `SCENARIO_SESSION_ENDED` as the persisted call duration net of
 * paused time. Roleplay only — not Scribe, not Track. Deliberately the SAME
 * column the Highlights practice-minutes chart and the certification card read,
 * so a reader can reconcile the three instead of finding three definitions of a
 * practice minute on one page.
 *
 * ## Who is counted
 *
 * LEARNER-group accounts in non-test tenants, read from `user_groups` ->
 * `groups.name` exactly as the certification, usage-level and cohort
 * repositories do. An admin racking up minutes while QA-ing a scenario is not a
 * learner reaching L3.
 *
 * `deletedAt` is deliberately NOT filtered, matching those siblings, so the
 * funnel's top row reconciles with the "Cumulative users" chart on the same tab
 * rather than being quietly smaller than it. Someone who practised 20 hours and
 * later had their account deactivated still did the practice.
 *
 * ## Conventions
 *
 * Follows the sibling repositories: `DataSource` raw SQL over tables BY NAME (no
 * entity repos), quoted camelCase identifiers (only `tenant_id` is snake_case),
 * dates out as `yyyy-mm-dd` strings, counts `::int` and re-parsed defensively.
 * `user_daily_scores."date"` is a DATE column, so `date_trunc` is pure calendar
 * maths and the keys line up with a UTC-generated axis regardless of the Node
 * process timezone.
 */
@Injectable()
export class UsageLadderAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The learner population every figure on this ladder is drawn from.
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
   * The period each learner CROSSED each rung, counted per period.
   *
   * The running total is computed in SQL with a window function over each
   * learner's per-period sums, and a rung's crossing period is the FIRST period
   * whose running total reaches its threshold. Three things about that matter:
   *
   *  - **Running, not per-period.** The thresholds are lifetime figures. Banding
   *    a single month's minutes would ask whether anyone practised 20 hours *in
   *    one month*, which is a different and much rarer event.
   *  - **First crossing, not current standing.** A learner is counted once per
   *    rung, in the period they reached it, and never again. Counting them every
   *    period after would make these bars a restatement of the cumulative line,
   *    and the chart would say one thing twice.
   *  - **One learner appears in several rungs' bars.** A learner who went from
   *    zero to 20 hours in one quarter crossed L1, L2 and L3 in it, and is
   *    counted in all three. The rungs are nested, so these series must never be
   *    stacked — a stack would imply they sum to a population.
   *
   * Computing the running total at the REQUESTED grain rather than always monthly
   * is exact, not an approximation: a cumulative total is monotonic, so the first
   * quarter whose closing total clears a threshold is by construction the quarter
   * containing the month that cleared it.
   *
   * All-time by construction: a window parameter would truncate each learner's
   * history and push their crossing later, or hide it entirely. Periods in which
   * nobody crossed anything are ABSENT — the service puts them back on the axis as
   * real zeros, because "nobody reached a new level" is a fact about that period.
   *
   * `minutesPlayed` is decimal(10,2); it is only ever summed and compared inside
   * SQL here, never in JS, so no string parsing is needed on this path.
   */
  async getAttainmentByPeriod(
    grain: UsageLadderGrain,
    tenantId?: string,
  ): Promise<UsageLadderPeriodRow[]> {
    const params: unknown[] = [UserRole.LEARNER, grain];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    // Thresholds travel as bound parameters like everything else: the ladder is a
    // module constant today, but a value interpolated "because it is ours" is the
    // habit that eventually interpolates one that is not. The grain is bound too
    // (`date_trunc($2, ...)`), so no part of this SQL is assembled from input.
    const crossingColumns = USAGE_LADDER_LEVELS.map((level, i) => {
      params.push(level.minMinutes);
      return (
        `MIN(period) FILTER (WHERE cumulative >= $${params.length}) ` +
        `AS "crossed${i}"`
      );
    }).join(',\n               ');

    // One (level, period) row per crossing rather than a period x learner grid.
    // The obvious shape — cross-join every period against every learner and
    // count where the crossing matches — is correct but scans learners once per
    // period; unpivoting the five crossing columns touches each crossing once.
    const crossingUnion = USAGE_LADDER_LEVELS.map(
      (_, i) =>
        `SELECT "crossed${i}" AS period, ${i} AS level ` +
        `FROM crossings WHERE "crossed${i}" IS NOT NULL`,
    ).join('\n        UNION ALL\n        ');

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      per_period AS (
        SELECT l.user_id,
               date_trunc($2, d."date")::date AS period,
               SUM(d."minutesPlayed")         AS minutes
        FROM learners l
        JOIN user_daily_scores d ON d."userId" = l.user_id
        GROUP BY l.user_id, period
      ),
      running AS (
        SELECT user_id,
               period,
               SUM(minutes) OVER (
                 PARTITION BY user_id
                 ORDER BY period
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS cumulative
        FROM per_period
      ),
      crossings AS (
        SELECT user_id,
               ${crossingColumns}
        FROM running
        GROUP BY user_id
      ),
      unpivoted AS (
        ${crossingUnion}
      )
      SELECT to_char(period, 'YYYY-MM-DD') AS "period",
             level                         AS "level",
             COUNT(*)::int                 AS "learners"
      FROM unpivoted
      GROUP BY period, level
      ORDER BY period ASC
      `,
      params,
    );

    // Pivot back to one row per period, with a dense per-level array. Periods
    // with no crossing at any rung are absent; the service gap-fills the axis.
    const byPeriod = new Map<string, number[]>();
    for (const raw of rows as Record<string, unknown>[]) {
      const period = raw.period as string;
      const level = Number(raw.level);
      if (!Number.isInteger(level) || !USAGE_LADDER_LEVELS[level]) continue;
      const counts = byPeriod.get(period) ?? USAGE_LADDER_LEVELS.map(() => 0);
      counts[level] = Number(raw.learners) || 0;
      byPeriod.set(period, counts);
    }

    return [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, newlyReachedByLevel]) => ({
        period,
        newlyReachedByLevel,
      }));
  }

  /**
   * Where the whole learner population stands against every rung RIGHT NOW —
   * the funnel from "account created" down to L5.
   *
   * `LEFT JOIN` on purpose: a learner who has never opened a simulation has no
   * `user_daily_scores` row, and they belong in the funnel's top row rather than
   * outside the population. They are precisely the drop-off the first step is
   * measuring, so excluding them would flatter every conversion below it.
   *
   * The steps are nested rather than exclusive — each is "learners at or past
   * this rung" — which is what makes the series a funnel that can only narrow.
   * A reader wanting "how many are exactly at L2" subtracts two adjacent steps;
   * a reader wanting a conversion rate divides them. Returning exclusive bands
   * instead would make the second reader do a running sum to get back to the
   * question they actually asked.
   */
  async getFunnel(tenantId?: string): Promise<UsageLadderFunnelRow> {
    const params: unknown[] = [UserRole.LEARNER];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const levelColumns = USAGE_LADDER_LEVELS.map((level, i) => {
      params.push(level.minMinutes);
      return (
        `COUNT(*) FILTER (WHERE t.minutes >= $${params.length})::int ` +
        `AS "level${i}"`
      );
    }).join(',\n        ');

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
      SELECT COUNT(*)::int AS "accounts",
        ${levelColumns}
      FROM totals t
      `,
      params,
    );

    const r = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      accounts: Number(r.accounts) || 0,
      everReachedByLevel: USAGE_LADDER_LEVELS.map(
        (_, i) => Number(r[`level${i}`]) || 0,
      ),
    };
  }

  /**
   * The first period any learner in scope practised at all — where the axis
   * begins.
   *
   * Without it a platform whose first L1 landed last month would draw a
   * two-point chart, and a reader could not tell a sudden success from the end of
   * a long climb. Null when nobody has ever practised.
   */
  async getFirstActivityPeriod(
    grain: UsageLadderGrain,
    tenantId?: string,
  ): Promise<string | null> {
    const params: unknown[] = [UserRole.LEARNER, grain];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)}
      SELECT to_char(MIN(date_trunc($2, d."date")::date), 'YYYY-MM-DD')
               AS "period"
      FROM user_daily_scores d
      JOIN learners l ON l.user_id = d."userId"
      WHERE d."minutesPlayed" > 0
      `,
      params,
    );

    const period = (rows[0] as Record<string, unknown> | undefined)?.period;
    return typeof period === 'string' ? period : null;
  }
}
