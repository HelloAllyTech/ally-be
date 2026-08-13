import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../../learn/enum/scenario-session-status.enum';
import { startOfUtcDay } from '../util/analytics-window.util';
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
   * Sum of `scenario_session_details.callDuration` (ms, net of paused time)
   * across sessions that have a details row. Sessions without one (details
   * write failed/skipped) are excluded, not treated as zero — see the
   * caller for the coverage caveat.
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
  roleplaySessionsStarted: number;
  roleplaySessionsCompleted: number;
  avgScore: number | null;
  totalDurationMs: number;
  coursesAssigned: number;
  coursesStarted: number;
  coursesCompleted: number;
}

export interface LearnerUsageOptions {
  search?: string;
  sortBy?: string;
  order?: 'ASC' | 'DESC';
  limit: number;
  offset: number;
}

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
  coursesAssigned: '"coursesAssigned"',
  coursesStarted: '"coursesStarted"',
  coursesCompleted: '"coursesCompleted"',
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
   * service. `totalDurationMs` sums `scenario_session_details.callDuration`
   * (ms, already net of paused time) across sessions that have a details
   * row — sessions without one (details write failed/skipped) are excluded
   * from the sum, not treated as zero, so this can under-count total
   * duration if coverage is incomplete.
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
        'COALESCE(SUM(d."callDuration"), 0)::bigint',
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
   * `roleplaySessionsStarted` counts by `startedAt` while `...Completed` counts
   * by `COALESCE(endedAt, createdAt)` — a session straddling the window
   * boundary can in principle show as completed without showing as started
   * that period; accepted as the same timestamp-field caveat already present
   * elsewhere in this file.
   */
  async getLearnerUsageRows(
    tenantId: string,
    start: Date,
    end: Date,
    opts: LearnerUsageOptions,
  ): Promise<{ rows: LearnerUsageRow[]; count: number }> {
    const sortColumn =
      LEARNER_USAGE_SORT_COLUMNS[opts.sortBy ?? ''] ??
      '"lastPracticeSessionAt"';
    const order = opts.order ?? 'ASC';
    const nulls = order === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST';
    const searchPattern = opts.search ? `%${opts.search}%` : null;

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
          SUM(d."callDuration") FILTER (
            WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND COALESCE(s."endedAt", s."createdAt") >= $2
              AND COALESCE(s."endedAt", s."createdAt") < $3
          ) AS "durationMs",
          AVG(d."compositeScore") FILTER (
            WHERE s.status = 'ENDED' AND s."eventStatus" = 'COMPLETED'
              AND COALESCE(s."endedAt", s."createdAt") >= $2
              AND COALESCE(s."endedAt", s."createdAt") < $3
          ) AS "avgScore"
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
          COUNT(*) FILTER (WHERE te."completedAt" IS NOT NULL) AS completed
        FROM track_enrollments te
        WHERE te."tenantId"::text = $1 AND te."deletedAt" IS NULL
        GROUP BY te."userId"
      ),
      joined AS (
        SELECT
          l.id, l.name, l.email, l."signupDate",
          rl."lastPracticeSessionAt" AS "lastPracticeSessionAt",
          COALESCE(rw.started, 0)::int AS "roleplaySessionsStarted",
          COALESCE(rw.completed, 0)::int AS "roleplaySessionsCompleted",
          rw."avgScore"::float AS "avgScore",
          COALESCE(rw."durationMs", 0)::bigint AS "totalDurationMs",
          COALESCE(c.assigned, 0)::int AS "coursesAssigned",
          COALESCE(c.started, 0)::int AS "coursesStarted",
          COALESCE(c.completed, 0)::int AS "coursesCompleted"
        FROM learners l
        LEFT JOIN roleplay_window rw ON rw.user_id = l.id
        LEFT JOIN roleplay_lifetime rl ON rl.user_id = l.id
        LEFT JOIN courses c ON c.user_id = l.id
      )
      SELECT *, COUNT(*) OVER ()::int AS "totalCount"
      FROM joined
      WHERE ($4::text IS NULL OR name ILIKE $4 OR email ILIKE $4)
      ORDER BY ${sortColumn} ${order} ${nulls}
      LIMIT $5 OFFSET $6
      `,
      [tenantId, start, end, searchPattern, opts.limit, opts.offset],
    );

    return {
      rows: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        email: r.email,
        signupDate: r.signupDate,
        lastPracticeSessionAt: r.lastPracticeSessionAt,
        roleplaySessionsStarted: Number(r.roleplaySessionsStarted) || 0,
        roleplaySessionsCompleted: Number(r.roleplaySessionsCompleted) || 0,
        avgScore: r.avgScore != null ? Number(r.avgScore) : null,
        totalDurationMs: Number(r.totalDurationMs) || 0,
        coursesAssigned: Number(r.coursesAssigned) || 0,
        coursesStarted: Number(r.coursesStarted) || 0,
        coursesCompleted: Number(r.coursesCompleted) || 0,
      })),
      count: rows.length > 0 ? Number(rows[0].totalCount) : 0,
    };
  }
}
