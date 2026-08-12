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
}
