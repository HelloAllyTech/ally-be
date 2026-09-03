import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../../learn/enum/scenario-session-status.enum';
import { LearnerUsageStatus } from '../dto/tenant-analytics.dto';
import { startOfUtcDay } from '../util/analytics-window.util';
import { sessionDurationMsExpr } from '../util/session-eligibility.util';
import { AnalyticsBucket } from './platform-analytics.repository';

export interface BucketCountRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  count: number;
}

export interface SessionEngagementTotals {
  totalSessions: number;
  /** Distinct counselorId with >=1 qualifying session in the window. */
  activeLearners: number;
  /**
   * Sum of the resolved session duration (ms, net of paused time): the
   * persisted `scenario_session_details.callDuration` where present, else the
   * session window — see {@link sessionDurationMsExpr}.
   */
  totalDurationMs: number;
}

export interface TimeToFirstSessionStats {
  /** Cohort users (new learners in the window) who have had >=1 qualifying session. */
  learnerCount: number;
  /** Mean days from account creation to first qualifying session; null if learnerCount is 0. */
  avgDays: number | null;
}

export interface SimulationUsageRow {
  scenarioId: number;
  title: string;
  sessionCount: number;
}

export interface LearnerUsageRow {
  id: number;
  name: string;
  email: string;
  signupDate: Date;
  /** All-time (not window-scoped) — see {@link TenantAnalyticsRepository.getLearnerUsageRows}. */
  lastPracticeSessionAt: Date | null;
  /**
   * Last sign of life ANYWHERE — the later of `lastPracticeSessionAt` and the
   * learner's most recent course activity. This, not roleplay alone, is what
   * `status` is derived from; see {@link TenantAnalyticsRepository.getLearnerUsageRows}.
   */
  lastActivityAt: Date | null;
  /** Whole days since `lastActivityAt`; null when the learner has never done anything. */
  daysSinceLastActivity: number | null;
  /** Derived in SQL so the status facet can be filtered before LIMIT/OFFSET. */
  status: LearnerUsageStatus;
  roleplaySessionsStarted: number;
  roleplaySessionsCompleted: number;
  avgScore: number | null;
  totalDurationMs: number;
  /**
   * Composite score summed over the same completed-in-window sessions that
   * `totalDurationMs` measures, divided by those minutes. Null when the window
   * holds no measurable practice time — never 0, which would read as "scored
   * nothing" rather than "nothing to score". Can be NEGATIVE: roleplay
   * composite scores do go below zero.
   */
  roleplayPointsPerMinute: number | null;
  coursesAssigned: number;
  coursesStarted: number;
  coursesCompleted: number;
  /** Level ladder position (1-10) and lifetime XP; 1 / 0 for a learner with no XP row yet. */
  level: number;
  totalXp: number;
  /** Course ITEMS across every enrolled course — rows exist for locked items too. */
  itemsTotal: number;
  itemsCompleted: number;
  /** itemsCompleted / itemsTotal as a percentage; null when nothing is enrolled. */
  itemsCompletedPct: number | null;
  /** Quiz items passed (the only item type with a graded result). */
  quizzesPassed: number;
  /** Quiz items with at least one graded attempt — the denominator behind `avgQuizScorePct`. */
  quizzesAttempted: number;
  /** Avg of the LATEST graded attempt per quiz item, so repeat failures show. */
  avgQuizScorePct: number | null;
  /** ARTICLE + VIDEO items completed. */
  readWatchCompleted: number;
  /** JOURNAL + ANNOTATED_ARTIFACT + GAME items completed. */
  reflectionCompleted: number;
}

export interface LearnerUsageOptions {
  search?: string;
  /** Status facet. Empty/undefined means no status filter. */
  statuses?: LearnerUsageStatus[];
  sortBy?: string;
  order?: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/**
 * Learner-usage status thresholds, in whole days since `lastActivityAt`.
 * A first cut, easy to retune once we see how tenant admins actually read the
 * table — not derived from any product spec.
 *
 * Exported because the status expression lives in SQL (it has to: the facet
 * filters and the pagination `count` both depend on it, so deriving it after
 * LIMIT/OFFSET would filter one page and lie about the total) while the
 * service still derives `daysSinceLastActivity` for the response. Both read
 * these same two numbers so they cannot drift apart.
 */
export const ACTIVE_WITHIN_DAYS = 14;
export const AT_RISK_WITHIN_DAYS = 30;

/** Whitelisted sort targets — never interpolate the client's `sortBy` directly into SQL. */
const LEARNER_USAGE_SORT_COLUMNS: Record<string, string> = {
  name: '"name"',
  email: '"email"',
  signupDate: '"signupDate"',
  lastPracticeSessionAt: '"lastPracticeSessionAt"',
  roleplaySessionsStarted: '"roleplaySessionsStarted"',
  roleplaySessionsCompleted: '"roleplaySessionsCompleted"',
  avgScore: '"avgScore"',
  // Public sort key matches the response field name (`totalPracticeMinutes`,
  // ms->minutes is a monotonic transform done in the service layer) rather
  // than this internal SQL alias.
  totalPracticeMinutes: '"totalDurationMs"',
  roleplayPointsPerMinute: '"roleplayPointsPerMinute"',
  coursesAssigned: '"coursesAssigned"',
  coursesStarted: '"coursesStarted"',
  coursesCompleted: '"coursesCompleted"',
  lastActivityAt: '"lastActivityAt"',
  // Alphabetical status order is meaningless; rank puts the learners who need
  // chasing first on an ASC sort. See `statusRank` in the SQL.
  status: '"statusRank"',
  level: '"level"',
  totalXp: '"totalXp"',
  itemsCompleted: '"itemsCompleted"',
  itemsCompletedPct: '"itemsCompletedPct"',
  quizzesPassed: '"quizzesPassed"',
  avgQuizScorePct: '"avgQuizScorePct"',
  readWatchCompleted: '"readWatchCompleted"',
  reflectionCompleted: '"reflectionCompleted"',
};

export interface CourseUsageRow {
  id: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  totalItems: number;
  /** Tenant-wide learner headcount — same value on every row, see {@link TenantAnalyticsRepository.getCourseUsageRows}. */
  learnersAssigned: number;
  learnersStarted: number;
  /** Superset of learnersCompleted100 — includes full completers. */
  learnersAtLeast50: number;
  learnersCompleted100: number;
  /** Days from startedAt to completedAt, over 100%-completers only; null when none have completed. */
  avgCompletionDays: number | null;
  medianCompletionDays: number | null;
  /** Avg `track_item_progress.score` for this tenant's enrolled learners; null when nothing is scored. */
  avgScore: number | null;
  /** Enrolled, not yet 100%, with lastActivityAt within 14 days. */
  inProgressActive: number;
  /** Enrolled, not yet 100%, stalled (lastActivityAt older than 14 days or never). */
  inProgressStalled: number;
  lastEnrollmentAt: Date | null;
}

export interface CourseUsageOptions {
  search?: string;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

/** Same 14-day threshold as the learner-usage table's "active" status. */
const COURSE_IN_PROGRESS_ACTIVE_WITHIN_DAYS = 14;

const COURSE_USAGE_SORT_COLUMNS: Record<string, string> = {
  title: '"title"',
  status: '"status"',
  totalItems: '"totalItems"',
  learnersStarted: '"learnersStarted"',
  learnersAtLeast50: '"learnersAtLeast50"',
  learnersCompleted100: '"learnersCompleted100"',
  avgCompletionDays: '"avgCompletionDays"',
  medianCompletionDays: '"medianCompletionDays"',
  avgScore: '"avgScore"',
  lastEnrollmentAt: '"lastEnrollmentAt"',
};

/**
 * Tenant-scoped organization-metrics queries for the tenant-admin dashboard.
 * Mirrors the conventions of PlatformAnalyticsRepository (raw counts, dates as
 * yyyy-mm-dd strings, shaping done in the service) with one difference: every
 * query filters on `tenant_id`, so a tenant admin only ever sees their own
 * organization.
 *
 * Two different "completed session" definitions are deliberately in play
 * here, per the metrics audit (Ally_Metrics_Reference.xlsx, "Revised
 * Implementation Plan"):
 * - `simulationsCompleted`/`activeUsers` (shipped first) use the original
 *   `eventStatus = COMPLETED` definition, timestamped by
 *   `COALESCE(endedAt, createdAt)` — left as-is, not revisited here.
 * - Every metric added below uses the plan's corrected signal,
 *   `status = ENDED AND eventStatus = COMPLETED` (eventStatus alone doesn't
 *   rule out a session that never properly ended), since that fix is exactly
 *   what makes these rows "ready to build" in the plan.
 * Both still can't distinguish a clean finish from a dropped/crashed call —
 * no ABANDONED/CRASHED status value exists on scenario_sessions.
 */
@Injectable()
export class TenantAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Simulations completed by the tenant's users within [start, end). */
  async getCompletedSimulationCount(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct tenant users with at least one completed simulation within
   * [start, end).
   */
  async getActiveUserCount(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Completed simulations grouped by bucket within [start, end). */
  async getCompletedSimulationsByBucket(
    tenantId: string,
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${bucket}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Distinct users with >=1 completed simulation, grouped by bucket within
   * [start, end).
   */
  async getActiveUsersByBucket(
    tenantId: string,
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${bucket}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * New LEARNER-role, non-suspended accounts created within [start, end).
   * `status != SUSPENDED` stands in for a "not deleted" filter — `users` has
   * no `deletedAt`/soft-delete mechanism, only ACTIVE/SUSPENDED statuses.
   */
  async getNewLearnersOnboardedCount(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .innerJoin('user_groups', 'ug', 'ug."userId" = u.id')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .where('u."tenant_id" = :tenantId', { tenantId })
      .andWhere('g.name = :learnerRole', { learnerRole: 'LEARNER' })
      .andWhere('u.status != :suspended', { suspended: 'SUSPENDED' })
      .andWhere('u."createdAt" >= :start', { start })
      .andWhere('u."createdAt" < :end', { end })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Same cohort as {@link getNewLearnersOnboardedCount}, grouped by bucket. */
  async getNewLearnersOnboardedByBucket(
    tenantId: string,
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${bucket}', u."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('users', 'u')
      .innerJoin('user_groups', 'ug', 'ug."userId" = u.id')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .where('u."tenant_id" = :tenantId', { tenantId })
      .andWhere('g.name = :learnerRole', { learnerRole: 'LEARNER' })
      .andWhere('u.status != :suspended', { suspended: 'SUSPENDED' })
      .andWhere('u."createdAt" >= :start', { start })
      .andWhere('u."createdAt" < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * All-time count of LEARNER-role, non-suspended accounts — a point-in-time
   * snapshot, deliberately not bounded by the dashboard's start/end window
   * (it's "how many learners do we have right now", not "in this period").
   */
  async getTotalRegisteredLearnersCount(tenantId: string): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .innerJoin('user_groups', 'ug', 'ug."userId" = u.id')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .where('u."tenant_id" = :tenantId', { tenantId })
      .andWhere('g.name = :learnerRole', { learnerRole: 'LEARNER' })
      .andWhere('u.status != :suspended', { suspended: 'SUSPENDED' })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Session-count/duration totals within [start, end), for computing "avg
   * sessions per active learner" and "avg practice time per learner" in the
   * service. `totalDurationMs` sums {@link sessionDurationMsExpr} (ms, net of
   * paused time), which prefers the persisted
   * `scenario_session_details.callDuration` and falls back to the session
   * window for sessions whose details row never received one — those used to
   * drop out of the sum entirely, understating practice time.
   */
  async getSessionEngagementTotals(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<SessionEngagementTotals> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'totalSessions')
      .addSelect('COUNT(DISTINCT s."counselorId")::int', 'activeLearners')
      .addSelect(
        `COALESCE(SUM(${sessionDurationMsExpr('s', 'd')}), 0)::bigint`,
        'totalDurationMs',
      )
      .from('scenario_sessions', 's')
      .leftJoin('scenario_session_details', 'd', 'd."scenarioSessionId" = s.id')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s.status = :ended', { ended: ScenarioSessionStatus.ENDED })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .getRawOne<{
        totalSessions: number;
        activeLearners: number;
        totalDurationMs: string;
      }>();

    return {
      totalSessions: Number(row?.totalSessions) || 0,
      activeLearners: Number(row?.activeLearners) || 0,
      totalDurationMs: Number(row?.totalDurationMs) || 0,
    };
  }

  /**
   * Mean days from account creation to first qualifying session, over
   * LEARNER-role, non-suspended accounts created within [start, end) — the
   * same "new learner" cohort as {@link getNewLearnersOnboardedCount}.
   * Learners with no qualifying session yet are excluded from the average
   * (not counted as 0 days), and `learnerCount` is the resulting n so the
   * caller can flag a thin sample rather than show a misleadingly confident
   * average.
   */
  async getTimeToFirstSessionStats(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<TimeToFirstSessionStats> {
    const rows = await this.dataSource.query<
      { learnerCount: string; avgDays: string | null }[]
    >(
      `
      SELECT
        COUNT(*)::int AS "learnerCount",
        AVG(EXTRACT(EPOCH FROM (fs."firstSessionAt" - u."createdAt")) / 86400.0) AS "avgDays"
      FROM users u
      INNER JOIN user_groups ug ON ug."userId" = u.id
      INNER JOIN groups g ON g.id = ug."groupId" AND g.name = 'LEARNER'
      INNER JOIN (
        SELECT s."counselorId" AS "counselorId",
               MIN(COALESCE(s."endedAt", s."createdAt")) AS "firstSessionAt"
        FROM scenario_sessions s
        WHERE s."tenant_id" = $1
          AND s.status = 'ENDED'
          AND s."eventStatus" = 'COMPLETED'
        GROUP BY s."counselorId"
      ) fs ON fs."counselorId" = u.id
      WHERE u."tenant_id" = $1
        AND u.status != 'SUSPENDED'
        AND u."createdAt" >= $2
        AND u."createdAt" < $3
      `,
      [tenantId, start, end],
    );

    const row = rows[0];
    return {
      learnerCount: Number(row?.learnerCount) || 0,
      avgDays: row?.avgDays != null ? Number(row.avgDays) : null,
    };
  }

  /**
   * The tenant's first row — where an all-time window starts for this
   * organization.
   *
   * Deliberately tenant-scoped rather than reusing `getPlatformDataFloor`: a
   * tenant that joined last month must not get an axis stretching back to the
   * platform's first account, which would prepend years of empty buckets to
   * charts that have no data there. `users` because nothing in an organization
   * predates its first account, and `scenario_sessions` as a lower bound in
   * case a migrated session does. Returns today (UTC day start) for a tenant
   * with no rows at all — an empty window over an empty organization is the
   * honest answer, and renders as the designed empty state.
   */
  async getTenantDataFloor(tenantId: string): Promise<Date> {
    const rows = await this.dataSource.query<{ floor: Date | string | null }[]>(
      `
      SELECT LEAST(
        (SELECT MIN(u."createdAt") FROM users u WHERE u."tenant_id" = $1),
        (SELECT MIN(s."createdAt") FROM scenario_sessions s WHERE s."tenant_id" = $1)
      ) AS floor
      `,
      [tenantId],
    );

    const floor = rows[0]?.floor;
    if (!floor) return startOfUtcDay(new Date());

    const parsed = floor instanceof Date ? floor : new Date(floor);
    if (Number.isNaN(parsed.getTime())) return startOfUtcDay(new Date());
    return startOfUtcDay(parsed);
  }

  /**
   * Top `limit` scenarios by completed-session count within [start, end).
   * Scenario titles are read even for soft-deleted scenarios (a later
   * deletion shouldn't erase historical usage from the ranking).
   */
  async getMostUsedSimulations(
    tenantId: string,
    start: Date,
    end: Date,
    limit: number,
  ): Promise<SimulationUsageRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('s."scenarioId"', 'scenarioId')
      .addSelect('sc.title', 'title')
      .addSelect('COUNT(*)::int', 'sessionCount')
      .from('scenario_sessions', 's')
      .innerJoin('scenarios', 'sc', 'sc.id = s."scenarioId"')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s.status = :ended', { ended: ScenarioSessionStatus.ENDED })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('s."scenarioId"')
      .addGroupBy('sc.title')
      .orderBy('"sessionCount"', 'DESC')
      .limit(limit)
      .getRawMany<{
        scenarioId: number;
        title: string | null;
        sessionCount: number;
      }>();

    return rows.map((r) => ({
      scenarioId: Number(r.scenarioId),
      title: r.title ?? `Scenario #${r.scenarioId}`,
      sessionCount: Number(r.sessionCount) || 0,
    }));
  }

  /**
   * One row per LEARNER-role, non-suspended user in the tenant, for the
   * per-learner usage table on the tenant-admin dashboard.
   *
   * `lastPracticeSessionAt`, `coursesAssigned/Started/Completed` are
   * deliberately all-time (not bounded by `start`/`end`) — recency-of-use and
   * course progress are standing state, not per-window activity counts.
   * `roleplaySessionsStarted/Completed`, `avgScore`, and the duration behind
   * `totalDurationMs` ARE bounded by `[start, end)`, using the same
   * `status = ENDED AND eventStatus = COMPLETED` completed-session
   * definition as {@link getSessionEngagementTotals}, so this table's numbers
   * reconcile with the "avg practice minutes per learner" KPI above it.
   * Duration comes from {@link sessionDurationMsExpr}, which falls back to the
   * session window when a details row carries no `callDuration` — without it a
   * learner could show a completed session and an avg score (both read off
   * that same row) next to 0 practice minutes.
   * `roleplaySessionsStarted` counts by `startedAt` while `...Completed` counts
   * by `COALESCE(endedAt, createdAt)` — a session straddling the window
   * boundary can in principle show as completed without showing as started
   * that period; accepted as the same timestamp-field caveat already present
   * elsewhere in this file.
   *
   * `lastActivityAt` is GREATEST(last roleplay, last course activity), and it —
   * not roleplay alone — is what `status` and `daysSinceLastActivity` derive
   * from. A learner working through quizzes and articles every day without
   * ever opening a roleplay used to render as "Never started", which defeated
   * the point of the status column. GREATEST ignores NULLs in Postgres, so a
   * learner with only one of the two still gets that one.
   *
   * `status` is computed HERE rather than in the service because the status
   * facet has to filter before LIMIT/OFFSET — deriving it after pagination
   * would filter a single page and report a `count` for the unfiltered set.
   * The thresholds come from the exported {@link ACTIVE_WITHIN_DAYS} /
   * {@link AT_RISK_WITHIN_DAYS} so SQL and service cannot disagree.
   *
   * The effort columns (`items*`, `quizzes*`, `readWatchCompleted`,
   * `reflectionCompleted`) are all-time like the course columns. ROLEPLAY and
   * CASE items are deliberately EXCLUDED from the type split: their sessions
   * are rows in `scenario_sessions` and are already counted by the roleplay
   * columns, so including them here would double-count the same work.
   * `avgQuizScorePct` averages the LATEST graded attempt per quiz item, not
   * `track_item_progress.score` — that column is only written on a pass
   * (see TrackQuizService), so averaging it would hide exactly the learner who
   * keeps failing.
   */
  async getLearnerUsageRows(
    tenantId: string,
    start: Date,
    end: Date,
    opts: LearnerUsageOptions,
  ): Promise<{ rows: LearnerUsageRow[]; count: number }> {
    const sortColumn =
      LEARNER_USAGE_SORT_COLUMNS[opts.sortBy ?? ''] ?? '"lastActivityAt"';
    const order = opts.order ?? 'ASC';
    const nulls = order === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST';
    const searchPattern = opts.search ? `%${opts.search}%` : null;
    // Empty array and undefined both mean "no status filter" — an empty
    // `statuses=` would otherwise match nothing and read as a broken table.
    const statuses = opts.statuses?.length ? opts.statuses : null;

    const rows = await this.dataSource.query<
      (LearnerUsageRow & { totalCount: string })[]
    >(
      `
      WITH learners AS (
        SELECT u.id, u.name, u.email, u."createdAt" AS "signupDate"
        FROM users u
        WHERE u."tenant_id" = $1
          AND u.status != 'SUSPENDED'
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )
      ),
      roleplay_window AS (
        SELECT
          s."counselorId" AS user_id,
          COUNT(*) FILTER (
            WHERE s."startedAt" >= $2 AND s."startedAt" < $3
          ) AS started,
          COUNT(*) FILTER (
            WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND COALESCE(s."endedAt", s."createdAt") >= $2
              AND COALESCE(s."endedAt", s."createdAt") < $3
          ) AS completed,
          SUM(${sessionDurationMsExpr('s', 'd')}) FILTER (
            WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND COALESCE(s."endedAt", s."createdAt") >= $2
              AND COALESCE(s."endedAt", s."createdAt") < $3
          ) AS "durationMs",
          AVG(d."compositeScore") FILTER (
            WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND COALESCE(s."endedAt", s."createdAt") >= $2
              AND COALESCE(s."endedAt", s."createdAt") < $3
          ) AS "avgScore",
          -- Same FILTER as "durationMs" on purpose: the two are a ratio, so
          -- they have to be summed over the identical session set or the rate
          -- silently mixes numerator and denominator populations.
          SUM(d."compositeScore") FILTER (
            WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND COALESCE(s."endedAt", s."createdAt") >= $2
              AND COALESCE(s."endedAt", s."createdAt") < $3
          ) AS "totalScore"
        FROM scenario_sessions s
        LEFT JOIN scenario_session_details d ON d."scenarioSessionId" = s.id
        WHERE s."tenant_id" = $1
        GROUP BY s."counselorId"
      ),
      roleplay_lifetime AS (
        SELECT s."counselorId" AS user_id,
          MAX(COALESCE(s."startedAt", s."createdAt")) AS "lastPracticeSessionAt"
        FROM scenario_sessions s
        WHERE s."tenant_id" = $1
        GROUP BY s."counselorId"
      ),
      courses AS (
        SELECT te."userId" AS user_id,
          COUNT(*) AS assigned,
          COUNT(*) FILTER (WHERE te."startedAt" IS NOT NULL) AS started,
          COUNT(*) FILTER (WHERE te."completedAt" IS NOT NULL) AS completed,
          MAX(te."lastActivityAt") AS "lastCourseActivityAt"
        FROM track_enrollments te
        WHERE te."tenantId"::text = $1 AND te."deletedAt" IS NULL
        GROUP BY te."userId"
      ),
      progress AS (
        SELECT up."userId" AS user_id,
          up."totalXp"::int AS "totalXp",
          up.level::int AS level
        FROM user_progress up
        WHERE up."tenant_id" = $1
      ),
      items AS (
        SELECT tip."userId" AS user_id,
          COUNT(*)::int AS "itemsTotal",
          COUNT(*) FILTER (WHERE tip.status = 'COMPLETED')::int
            AS "itemsCompleted",
          COUNT(*) FILTER (
            WHERE tip.status = 'COMPLETED' AND ti.type = 'QUIZ'
          )::int AS "quizzesPassed",
          COUNT(*) FILTER (
            WHERE tip.status = 'COMPLETED' AND ti.type IN ('ARTICLE', 'VIDEO')
          )::int AS "readWatchCompleted",
          COUNT(*) FILTER (
            WHERE tip.status = 'COMPLETED'
              AND ti.type IN ('JOURNAL', 'ANNOTATED_ARTIFACT', 'GAME')
          )::int AS "reflectionCompleted"
        FROM track_item_progress tip
        JOIN track_enrollments te ON te.id = tip."trackEnrollmentId"
        JOIN track_items ti ON ti.id = tip."trackItemId"
        WHERE te."tenantId"::text = $1
          AND te."deletedAt" IS NULL
          AND tip."deletedAt" IS NULL
          AND ti."deletedAt" IS NULL
        GROUP BY tip."userId"
      ),
      quiz_latest AS (
        SELECT DISTINCT ON (tqa."trackItemProgressId")
          tqa."userId" AS user_id,
          tqa."scorePct"
        FROM track_quiz_attempts tqa
        JOIN track_item_progress tip ON tip.id = tqa."trackItemProgressId"
        JOIN track_enrollments te ON te.id = tip."trackEnrollmentId"
        WHERE te."tenantId"::text = $1
          AND te."deletedAt" IS NULL
          AND tip."deletedAt" IS NULL
          AND tqa."deletedAt" IS NULL
          AND tqa."scorePct" IS NOT NULL
        ORDER BY tqa."trackItemProgressId", tqa."attemptNumber" DESC
      ),
      quizzes AS (
        SELECT user_id,
          COUNT(*)::int AS "quizzesAttempted",
          AVG("scorePct")::float AS "avgQuizScorePct"
        FROM quiz_latest
        GROUP BY user_id
      ),
      joined AS (
        SELECT
          l.id, l.name, l.email, l."signupDate",
          rl."lastPracticeSessionAt" AS "lastPracticeSessionAt",
          GREATEST(
            rl."lastPracticeSessionAt", c."lastCourseActivityAt"
          ) AS "lastActivityAt",
          COALESCE(rw.started, 0)::int AS "roleplaySessionsStarted",
          COALESCE(rw.completed, 0)::int AS "roleplaySessionsCompleted",
          rw."avgScore"::float AS "avgScore",
          COALESCE(rw."durationMs", 0)::bigint AS "totalDurationMs",
          CASE
            WHEN COALESCE(rw."durationMs", 0) > 0
              THEN rw."totalScore"::float / (rw."durationMs"::float / 60000)
            ELSE NULL
          END AS "roleplayPointsPerMinute",
          COALESCE(c.assigned, 0)::int AS "coursesAssigned",
          COALESCE(c.started, 0)::int AS "coursesStarted",
          COALESCE(c.completed, 0)::int AS "coursesCompleted",
          COALESCE(pr.level, 1)::int AS "level",
          COALESCE(pr."totalXp", 0)::int AS "totalXp",
          COALESCE(i."itemsTotal", 0)::int AS "itemsTotal",
          COALESCE(i."itemsCompleted", 0)::int AS "itemsCompleted",
          CASE
            WHEN COALESCE(i."itemsTotal", 0) > 0
              THEN (i."itemsCompleted"::float / i."itemsTotal") * 100
            ELSE NULL
          END AS "itemsCompletedPct",
          COALESCE(i."quizzesPassed", 0)::int AS "quizzesPassed",
          COALESCE(q."quizzesAttempted", 0)::int AS "quizzesAttempted",
          q."avgQuizScorePct" AS "avgQuizScorePct",
          COALESCE(i."readWatchCompleted", 0)::int AS "readWatchCompleted",
          COALESCE(i."reflectionCompleted", 0)::int AS "reflectionCompleted"
        FROM learners l
        LEFT JOIN roleplay_window rw ON rw.user_id = l.id
        LEFT JOIN roleplay_lifetime rl ON rl.user_id = l.id
        LEFT JOIN courses c ON c.user_id = l.id
        LEFT JOIN progress pr ON pr.user_id = l.id
        LEFT JOIN items i ON i.user_id = l.id
        LEFT JOIN quizzes q ON q.user_id = l.id
      ),
      aged AS (
        SELECT j.*,
          FLOOR(
            EXTRACT(
              EPOCH FROM ((now() AT TIME ZONE 'UTC') - j."lastActivityAt")
            ) / 86400
          )::int AS "daysSinceLastActivity"
        FROM joined j
      ),
      statused AS (
        SELECT a.*,
          CASE
            WHEN a."daysSinceLastActivity" IS NULL THEN 0
            WHEN a."daysSinceLastActivity" > ${AT_RISK_WITHIN_DAYS} THEN 1
            WHEN a."daysSinceLastActivity" > ${ACTIVE_WITHIN_DAYS} THEN 2
            ELSE 3
          END AS "statusRank",
          CASE
            WHEN a."daysSinceLastActivity" IS NULL THEN 'never_started'
            WHEN a."daysSinceLastActivity" > ${AT_RISK_WITHIN_DAYS}
              THEN 'dormant'
            WHEN a."daysSinceLastActivity" > ${ACTIVE_WITHIN_DAYS}
              THEN 'at_risk'
            ELSE 'active'
          END AS status
        FROM aged a
      )
      SELECT *, COUNT(*) OVER ()::int AS "totalCount"
      FROM statused
      WHERE ($4::text IS NULL OR name ILIKE $4 OR email ILIKE $4)
        AND ($7::text[] IS NULL OR status = ANY($7))
      ORDER BY ${sortColumn} ${order} ${nulls}
      LIMIT $5 OFFSET $6
      `,
      [tenantId, start, end, searchPattern, opts.limit, opts.offset, statuses],
    );

    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        email: r.email,
        signupDate: r.signupDate,
        lastPracticeSessionAt: r.lastPracticeSessionAt,
        lastActivityAt: r.lastActivityAt,
        daysSinceLastActivity:
          r.daysSinceLastActivity != null
            ? Number(r.daysSinceLastActivity)
            : null,
        status: r.status,
        roleplaySessionsStarted: Number(r.roleplaySessionsStarted) || 0,
        roleplaySessionsCompleted: Number(r.roleplaySessionsCompleted) || 0,
        avgScore: r.avgScore != null ? Number(r.avgScore) : null,
        totalDurationMs: Number(r.totalDurationMs) || 0,
        roleplayPointsPerMinute:
          r.roleplayPointsPerMinute != null
            ? Number(r.roleplayPointsPerMinute)
            : null,
        coursesAssigned: Number(r.coursesAssigned) || 0,
        coursesStarted: Number(r.coursesStarted) || 0,
        coursesCompleted: Number(r.coursesCompleted) || 0,
        level: Number(r.level) || 1,
        totalXp: Number(r.totalXp) || 0,
        itemsTotal: Number(r.itemsTotal) || 0,
        itemsCompleted: Number(r.itemsCompleted) || 0,
        itemsCompletedPct:
          r.itemsCompletedPct != null ? Number(r.itemsCompletedPct) : null,
        quizzesPassed: Number(r.quizzesPassed) || 0,
        quizzesAttempted: Number(r.quizzesAttempted) || 0,
        avgQuizScorePct:
          r.avgQuizScorePct != null ? Number(r.avgQuizScorePct) : null,
        readWatchCompleted: Number(r.readWatchCompleted) || 0,
        reflectionCompleted: Number(r.reflectionCompleted) || 0,
      })),
      count: rows.length > 0 ? Number(rows[0].totalCount) : 0,
    };
  }

  /**
   * One row per Track 2.0 course visible to the tenant (ACTIVE or ARCHIVED,
   * joined through `track_tenants`), for the per-course usage table on the
   * tenant-admin dashboard. Zero-enrollment courses still produce a row
   * (LEFT JOIN, driven from the course list, not from enrollments).
   *
   * Deliberately all-time throughout — a course's lifetime performance, not
   * scoped to the dashboard's period toggle, matching the per-learner usage
   * table's treatment of its own course columns.
   *
   * `learnersAssigned` is the tenant's total learner headcount, not a
   * per-course assignment count — Track 2.0 has no per-learner "assigned but
   * not started" event (enrolling sets `startedAt` immediately), so every
   * active catalog course is implicitly available to every learner in a
   * tenant that has it enabled.
   */
  async getCourseUsageRows(
    tenantId: string,
    opts: CourseUsageOptions,
  ): Promise<{ rows: CourseUsageRow[]; count: number }> {
    const sortColumn =
      COURSE_USAGE_SORT_COLUMNS[opts.sortBy ?? ''] ?? '"learnersStarted"';
    const order = opts.order ?? 'ASC';
    const nulls = order === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST';
    const searchPattern = opts.search ? `%${opts.search}%` : null;

    const rows = await this.dataSource.query<
      (CourseUsageRow & { totalCount: string })[]
    >(
      `
      WITH tenant_learner_count AS (
        SELECT COUNT(*)::int AS cnt
        FROM users u
        WHERE u."tenant_id" = $1
          AND u.status != 'SUSPENDED'
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )
      ),
      courses AS (
        SELECT t.id, t.title, t.status, t."totalItems"
        FROM tracks t
        INNER JOIN track_tenants tt
          ON tt."trackId" = t.id AND tt."tenantId"::text = $1 AND tt."deletedAt" IS NULL
        WHERE t."deletedAt" IS NULL AND t.status IN ('ACTIVE', 'ARCHIVED')
      ),
      tenant_enrollments AS (
        SELECT te.id, te."trackId", te."startedAt", te."completedAt",
               te."completedItems", te."lastActivityAt"
        FROM track_enrollments te
        INNER JOIN users u ON te."userId" = u.id
        WHERE u."tenant_id" = $1
          AND u.status != 'SUSPENDED'
          AND te."deletedAt" IS NULL
          AND EXISTS (
                SELECT 1 FROM user_groups ug
                JOIN groups g ON g.id = ug."groupId"
                WHERE ug."userId" = u.id AND g.name = 'LEARNER'
              )
      ),
      enrollment_stats AS (
        SELECT
          e."trackId",
          COUNT(*)::int AS started,
          COUNT(*) FILTER (
            WHERE c."totalItems" > 0
              AND e."completedItems"::float / c."totalItems" >= 0.5
          )::int AS "atLeast50",
          COUNT(*) FILTER (WHERE e."completedAt" IS NOT NULL)::int AS completed100,
          AVG(
            EXTRACT(EPOCH FROM (e."completedAt" - e."startedAt")) / 86400.0
          ) FILTER (WHERE e."completedAt" IS NOT NULL) AS "avgCompletionDays",
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (e."completedAt" - e."startedAt")) / 86400.0
          ) FILTER (WHERE e."completedAt" IS NOT NULL) AS "medianCompletionDays",
          COUNT(*) FILTER (
            WHERE e."completedAt" IS NULL
              AND e."lastActivityAt" >= now() - make_interval(days => ${COURSE_IN_PROGRESS_ACTIVE_WITHIN_DAYS})
          )::int AS "inProgressActive",
          COUNT(*) FILTER (
            WHERE e."completedAt" IS NULL
              AND (
                e."lastActivityAt" IS NULL
                OR e."lastActivityAt" < now() - make_interval(days => ${COURSE_IN_PROGRESS_ACTIVE_WITHIN_DAYS})
              )
          )::int AS "inProgressStalled",
          MAX(e."startedAt") AS "lastEnrollmentAt"
        FROM tenant_enrollments e
        INNER JOIN courses c ON c.id = e."trackId"
        GROUP BY e."trackId"
      ),
      score_stats AS (
        SELECT te2."trackId", AVG(tip.score) AS "avgScore"
        FROM track_item_progress tip
        INNER JOIN tenant_enrollments te2 ON te2.id = tip."trackEnrollmentId"
        WHERE tip.score IS NOT NULL AND tip."deletedAt" IS NULL
        GROUP BY te2."trackId"
      ),
      joined AS (
        SELECT
          c.id, c.title, c.status, c."totalItems",
          (SELECT cnt FROM tenant_learner_count) AS "learnersAssigned",
          COALESCE(es.started, 0) AS "learnersStarted",
          COALESCE(es."atLeast50", 0) AS "learnersAtLeast50",
          COALESCE(es.completed100, 0) AS "learnersCompleted100",
          es."avgCompletionDays",
          es."medianCompletionDays",
          ss."avgScore",
          COALESCE(es."inProgressActive", 0) AS "inProgressActive",
          COALESCE(es."inProgressStalled", 0) AS "inProgressStalled",
          es."lastEnrollmentAt"
        FROM courses c
        LEFT JOIN enrollment_stats es ON es."trackId" = c.id
        LEFT JOIN score_stats ss ON ss."trackId" = c.id
      )
      SELECT *, COUNT(*) OVER ()::int AS "totalCount"
      FROM joined
      WHERE ($2::text IS NULL OR title ILIKE $2)
      ORDER BY ${sortColumn} ${order} ${nulls}
      LIMIT $3 OFFSET $4
      `,
      [tenantId, searchPattern, opts.limit, opts.offset],
    );

    return {
      rows: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        totalItems: Number(r.totalItems) || 0,
        learnersAssigned: Number(r.learnersAssigned) || 0,
        learnersStarted: Number(r.learnersStarted) || 0,
        learnersAtLeast50: Number(r.learnersAtLeast50) || 0,
        learnersCompleted100: Number(r.learnersCompleted100) || 0,
        avgCompletionDays:
          r.avgCompletionDays != null ? Number(r.avgCompletionDays) : null,
        medianCompletionDays:
          r.medianCompletionDays != null
            ? Number(r.medianCompletionDays)
            : null,
        avgScore: r.avgScore != null ? Number(r.avgScore) : null,
        inProgressActive: Number(r.inProgressActive) || 0,
        inProgressStalled: Number(r.inProgressStalled) || 0,
        lastEnrollmentAt: r.lastEnrollmentAt,
      })),
      count: rows.length > 0 ? Number(rows[0].totalCount) : 0,
    };
  }
}
