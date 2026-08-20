import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '../../common/constants/user.constants';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { AnalyticsBucket } from './platform-analytics.repository';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { getPlatformDataFloor } from '../util/data-floor.util';

/**
 * How much practice makes a session or a day COUNT.
 *
 * Five minutes. Below it a roleplay is someone opening a simulation and closing
 * it — a click, not a practice session — and letting those in makes every
 * engagement number a measure of curiosity rather than of learning. One constant
 * for both charts here, so "a real practice session" and "a day they practised"
 * cannot come to mean two different amounts of time.
 */
export const QUALIFYING_MINUTES = 5;

/** `scenario_session_details."callDuration"` is milliseconds. */
export const QUALIFYING_MS = QUALIFYING_MINUTES * 60_000;

/**
 * How many rungs the stickiness funnel shows.
 *
 * Consecutive (1st qualifying day, 2nd, 3rd, …) rather than a spread like
 * 1/5/20/50, because the question the funnel answers is "having practised once,
 * do they come back" — and that is a step-to-step conversion. A spread would
 * force the reader to divide across an unknown number of missing steps to get the
 * same number.
 *
 * Ten is where the curve has flattened for any realistic cohort; the tail beyond
 * it is reported as one aggregate so the total still reconciles.
 */
export const STICKINESS_STEPS = 10;

/** Learners bucketed by how many qualifying days they have, ever. */
export interface ActiveDayHistogramRow {
  /** Number of qualifying days. */
  activeDays: number;
  /** Learners with exactly that many. */
  learners: number;
}

/** One bucket of the qualifying-session trend. */
export interface QualifiedSessionBucketRow {
  /** Bucket start, `yyyy-mm-dd`. */
  bucket: string;
  /** Completed sessions of at least {@link QUALIFYING_MINUTES}. */
  qualifiedSessions: number;
  /** All completed sessions in the bucket — the denominator. */
  completedSessions: number;
}

/**
 * Depth of practice: do learners come back, and how many sessions are long enough
 * to be practice at all.
 *
 * Two questions off one threshold, which is why they share a repository. If the
 * stickiness funnel counted five-minute days while the session chart counted
 * three-minute sessions, a reader could not use either to explain the other.
 *
 * ## Days, not sessions, for stickiness
 *
 * A step is a DAY carrying at least {@link QUALIFYING_MINUTES} of practice, read
 * from `user_daily_scores` — so three back-to-back sessions on one evening are
 * one step, not three. The funnel is measuring whether someone RETURNS, and a
 * definition that rewards a single long evening would report a learner who never
 * came back as highly sticky.
 *
 * Note this is a day TOTAL, not "a day containing one session of five minutes":
 * two three-minute sessions make a qualifying day. That is the deliberate reading
 * — the threshold is there to exclude a day of idle clicking, and a learner who
 * practised six minutes across two attempts did practise. The session chart below
 * is where a single session's length is judged.
 *
 * ## Ever, with no window
 *
 * "Did they come back" has no natural window: a learner whose second qualifying
 * day was fourteen months after their first did come back. Windowing this would
 * report every recent signup as churned, because the window ends before they had
 * the chance. The funnel is therefore all-time and the card says so.
 *
 * ## Conventions
 *
 * Follows the sibling repositories: raw SQL over tables BY NAME, quoted camelCase
 * identifiers (only `tenant_id` is snake_case), dates out as `yyyy-mm-dd`, counts
 * `::int` and re-parsed defensively.
 */
@Injectable()
export class PracticeDepthAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * Deliberately the same measurement every sibling endpoint uses, so charts
   * composed onto one tab cover the same period rather than two axes that
   * nearly line up. See {@link getPlatformDataFloor}.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * The learner population, matching every other ladder/level chart on the tab.
   *
   * `$1` is always the LEARNER group name; `tenantPlaceholder` is the tenant when
   * narrowing. `deletedAt` is deliberately not filtered, as in the sibling
   * repositories, so the funnel's top row reconciles with the learner counts
   * beside it.
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
   * Learners by their COUNT of qualifying days, ever.
   *
   * A histogram rather than the funnel itself: the funnel's step N is "learners
   * with at least N qualifying days", which is a suffix sum over this. Returning
   * the histogram means the service can build every step, the tail aggregate and
   * the median from one pass, and a reader asking "how many people practised
   * exactly twice" is answerable without another query.
   *
   * Learners with zero qualifying days are ABSENT here — they have no
   * `user_daily_scores` row to count — and are not needed: the funnel's first
   * step is "practised once", not "created an account". The account population is
   * the usage-ladder funnel's business, and duplicating it here would invite the
   * two to disagree.
   */
  async getActiveDayHistogram(
    tenantId?: string,
  ): Promise<ActiveDayHistogramRow[]> {
    const params: unknown[] = [UserRole.LEARNER, QUALIFYING_MINUTES];
    let tenantPlaceholder: string | undefined;
    if (tenantId) {
      params.push(tenantId);
      tenantPlaceholder = `$${params.length}`;
    }

    const rows = await this.dataSource.query(
      `
      WITH ${this.learnersCte(tenantPlaceholder)},
      qualifying_days AS (
        SELECT d."userId"     AS user_id,
               COUNT(*)::int  AS active_days
        FROM user_daily_scores d
        JOIN learners l ON l.user_id = d."userId"
        WHERE d."minutesPlayed" >= $2
        GROUP BY d."userId"
      )
      SELECT active_days   AS "activeDays",
             COUNT(*)::int AS "learners"
      FROM qualifying_days
      GROUP BY active_days
      ORDER BY active_days ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      activeDays: Number(r.activeDays) || 0,
      learners: Number(r.learners) || 0,
    }));
  }

  /**
   * Completed sessions of at least {@link QUALIFYING_MINUTES}, per bucket, with
   * the all-completed count beside them.
   *
   * Both numbers, not just the qualifying one: a fall in five-minute sessions
   * means something quite different when total sessions fell with it (quieter
   * platform) than when they did not (sessions getting shorter, or failing
   * earlier). One without the other is an invitation to guess which happened.
   *
   * Definition deliberately identical to the tab's "completed simulation" —
   * `eventStatus = COMPLETED`, timestamped by `COALESCE(endedAt, createdAt)`,
   * duration from `scenario_session_details."callDuration"` in MILLISECONDS net
   * of paused time — so this chart reconciles with the completed-simulations and
   * play-time charts rather than nearly reconciling.
   *
   * Sessions with a NULL or non-positive duration are excluded from BOTH counts,
   * matching the play-time chart: a session that produced no measurable time is a
   * session that did not happen, and leaving it in the denominator alone would
   * make the qualifying share fall whenever the failure rate rose.
   *
   * Preview and seed rooms are excluded through the shared
   * {@link countableSessionPredicate}.
   */
  async getQualifiedSessionsByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<QualifiedSessionBucketRow[]> {
    const params: unknown[] = [
      bucket,
      ScenarioSessionEventStatus.COMPLETED,
      start,
      end,
      QUALIFYING_MS,
    ];
    let tenantPredicate = '';
    if (tenantId) {
      params.push(tenantId);
      tenantPredicate = `AND ${scopeToTenant('s."tenant_id"', `$${params.length}`)}`;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        to_char(
          date_trunc($1, COALESCE(s."endedAt", s."createdAt")),
          'YYYY-MM-DD'
        )                                                    AS "bucket",
        COUNT(*) FILTER (WHERE d."callDuration" >= $5)::int   AS "qualifiedSessions",
        COUNT(*)::int                                        AS "completedSessions"
      FROM scenario_sessions s
      JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
      WHERE s."eventStatus" = $2
        AND d."callDuration" IS NOT NULL
        AND d."callDuration" > 0
        AND COALESCE(s."endedAt", s."createdAt") >= $3
        AND COALESCE(s."endedAt", s."createdAt") < $4
        AND ${countableSessionPredicate('s')}
        AND ${excludeTestTenants('s."tenant_id"')}
        ${tenantPredicate}
      GROUP BY 1
      ORDER BY 1 ASC
      `,
      params,
    );

    return rows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket as string,
      qualifiedSessions: Number(r.qualifiedSessions) || 0,
      completedSessions: Number(r.completedSessions) || 0,
    }));
  }
}

/**
 * Smallest population the stickiness funnel's PERCENTAGES may be stated for.
 *
 * Same reasoning and same number as the cohort grid and the usage-level bars:
 * "67% of the 3 learners who practised" names an individual to anyone who knows
 * the org. Below the floor the funnel keeps its counts and loses its shares.
 * Re-exported from `MIN_COHORT_SIZE` rather than redeclared so there is one place
 * to change it.
 */
export const MIN_STICKINESS_POPULATION = MIN_COHORT_SIZE;
