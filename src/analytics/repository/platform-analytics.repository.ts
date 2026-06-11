import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';

/**
 * Bucket granularity for time-series aggregation. Controlled internally by the
 * service (never user input) so it is safe to interpolate into `date_trunc`.
 */
export type AnalyticsBucket = 'week' | 'month';

export interface NewUsersBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  newUsers: number;
}

export interface DailyActivityRow {
  /** Activity day as a calendar date string (yyyy-mm-dd). */
  day: string;
  counselorId: number;
}

export interface WeeklyCountRow {
  /** ISO week start (Monday) as a calendar date string (yyyy-mm-dd). */
  week: string;
  count: number;
}

export interface WeeklyActiveUserRow {
  /** ISO week start (Monday) of the activity, as yyyy-mm-dd. */
  week: string;
  counselorId: number;
  /** The user's account creation date, as yyyy-mm-dd. */
  userCreatedAt: string;
}

export interface UsersByRoleRow {
  role: string;
  count: number;
}

/**
 * Raw cross-table aggregation for the super-admin analytics overview.
 *
 * Uses a `DataSource`-backed query builder (rather than a single-entity
 * repository) because the queries span `users`, `scenario_sessions`,
 * `user_groups` and `groups`. Column names are the default TypeORM camelCase
 * identifiers (quoted in SQL); `tenantId` maps to the `tenant_id` column.
 * These are platform-wide (super-admin) metrics, so they are deliberately
 * NOT scoped to a tenant.
 *
 * Truncated dates are returned as `yyyy-mm-dd` strings (`to_char`) rather than
 * timestamps: `date_trunc` on the tz-naive `timestamp` columns is pure
 * calendar math, so the string keys match a UTC-generated JS axis exactly,
 * regardless of the Node process timezone. Counts are cast to `::int` so the
 * pg driver returns JS numbers; the service still parses defensively. Heavier
 * shaping (cumulative sums, rolling DAU/WAU/MAU, new-vs-returning labelling) is
 * done in JS to keep the SQL simple.
 */
@Injectable()
export class PlatformAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): 'week' | 'month' {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    return bucket === 'month' ? 'month' : 'week';
  }

  /**
   * New users per time bucket within [start, end). Cumulative totals are
   * computed in the service from these counts plus {@link getUserCountBefore}.
   */
  async getNewUsersByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<NewUsersBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', u."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'newUsers')
      .from('users', 'u')
      .where('u."createdAt" >= :start', { start })
      .andWhere('u."createdAt" < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; newUsers: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      newUsers: Number(r.newUsers) || 0,
    }));
  }

  /** Total number of users created strictly before `date` (cumulative baseline). */
  async getUserCountBefore(date: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .where('u."createdAt" < :date', { date })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Total number of users on the platform. */
  async getTotalUsers(): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('users', 'u')
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct (day, counselorId) activity pairs from scenario sessions within
   * [start, end). Pass a start that is 29 days before the visible window so the
   * service can compute correct trailing 7-/30-day rolls at the left edge.
   * Activity timestamp is `COALESCE(startedAt, createdAt)`.
   */
  async getDailyActivityPairs(
    start: Date,
    end: Date,
  ): Promise<DailyActivityRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(COALESCE(s."startedAt", s."createdAt"), 'YYYY-MM-DD')`,
        'day',
      )
      .addSelect('s."counselorId"', 'counselorId')
      .distinct(true)
      .from('scenario_sessions', 's')
      .where('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .getRawMany<{ day: string; counselorId: number }>();

    return rows.map((r) => ({
      day: r.day,
      counselorId: Number(r.counselorId),
    }));
  }

  /**
   * Completed simulations grouped by ISO week within [start, end).
   * Completion timestamp is `COALESCE(endedAt, createdAt)`.
   */
  async getSimulationsCompletedByWeek(
    start: Date,
    end: Date,
  ): Promise<WeeklyCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('week', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'week',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('week')
      .orderBy('week', 'ASC')
      .getRawMany<{ week: string; count: number }>();

    return rows.map((r) => ({
      week: r.week,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Distinct weekly-active (week, counselorId) pairs within [start, end),
   * joined to the user's account creation date so the service can label each
   * weekly-active user as "new" (account created that week) or "returning".
   * Activity timestamp is `COALESCE(startedAt, createdAt)`.
   */
  async getWeeklyActivePairsWithCreatedAt(
    start: Date,
    end: Date,
  ): Promise<WeeklyActiveUserRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('week', COALESCE(s."startedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'week',
      )
      .addSelect('s."counselorId"', 'counselorId')
      .addSelect(`to_char(u."createdAt", 'YYYY-MM-DD')`, 'userCreatedAt')
      .distinct(true)
      .from('scenario_sessions', 's')
      .innerJoin('users', 'u', 'u.id = s."counselorId"')
      .where('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .getRawMany<{
        week: string;
        counselorId: number;
        userCreatedAt: string;
      }>();

    return rows.map((r) => ({
      week: r.week,
      counselorId: Number(r.counselorId),
      userCreatedAt: r.userCreatedAt,
    }));
  }

  /** Distinct user counts grouped by role/group name. */
  async getUsersByRole(): Promise<UsersByRoleRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('g.name', 'role')
      .addSelect('COUNT(DISTINCT ug."userId")::int', 'count')
      .from('user_groups', 'ug')
      .innerJoin('groups', 'g', 'g.id = ug."groupId"')
      .groupBy('g.name')
      .orderBy('count', 'DESC')
      .getRawMany<{ role: string; count: number }>();

    return rows.map((r) => ({
      role: r.role,
      count: Number(r.count) || 0,
    }));
  }

  /** Distinct users with any session activity since `since`. */
  async getActiveUserCountSince(since: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('COALESCE(s."startedAt", s."createdAt") >= :since', { since })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct active users since `since` whose account predates `since`
   * (i.e. returning users, used for the retention rate).
   */
  async getReturningActiveUserCountSince(since: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .innerJoin('users', 'u', 'u.id = s."counselorId"')
      .where('COALESCE(s."startedAt", s."createdAt") >= :since', { since })
      .andWhere('u."createdAt" < :since', { since })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Completed simulations whose completion timestamp is on/after `since`. */
  async getCompletedSimsSince(since: Date): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :since', { since })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }
}
