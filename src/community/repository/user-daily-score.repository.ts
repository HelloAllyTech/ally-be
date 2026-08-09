import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserDailyScores } from '../entity/user-daily-scores.entity';
import { Pagination } from 'src/common/type/common.type';
import { LeaderboardEntryDto } from '../dto/leaderboard.dto';
import { LeaderboardResult, UserRankResult } from '../type/leaderboard.type';
import { scorePoints } from '../constant/community.constant';
import { toBusinessDateString } from 'src/common/util/date.util';
import { StreakStatsRow } from '../type/practice-streak.type';

export interface UpsertDailyScoreResult {
  /** The business-timezone calendar day (YYYY-MM-DD) this write landed on. */
  businessDate: string;
  /** Cumulative minutes played for that day after this write. */
  minutesAfter: number;
  /** True when THIS write pushed the day across the 1.00-minute active-day line. */
  crossedActiveThreshold: boolean;
}

@Injectable()
export class UserDailyScoreRepository extends Repository<UserDailyScores> {
  constructor(private dataSource: DataSource) {
    super(UserDailyScores, dataSource.createEntityManager());
  }

  /**
   * Upserts daily score for play time.
   * Awards: minutesToAdd points + 1 active day bonus (when minutesPlayed reaches >= 1)
   * Active day bonus is awarded only when cumulative minutesPlayed crosses the 1 minute threshold
   *
   * Returns whether this write crossed the active-day threshold. A day can only
   * cross once, so callers can use it to trigger once-per-active-day work
   * (streak badges) without a separate pre-read.
   */
  async upsertDailyScore(
    userId: number,
    tenantId: string,
    date: Date,
    minutesToAdd: number,
  ): Promise<UpsertDailyScoreResult> {
    const normalizedDate = toBusinessDateString(date);

    const rows = await this.query(
      `
      INSERT INTO user_daily_scores ("id", "userId", "tenant_id", "date", "minutesPlayed", "totalScore", "createdAt", "updatedAt")
      VALUES (
        uuid_generate_v4(), $1, $2, $3::date, $4,
        $4 + CASE WHEN $4 >= 1.00 THEN 1.00 ELSE 0.00 END,
        NOW(), NOW()
      )
      ON CONFLICT ("userId", "tenant_id", "date")
      DO UPDATE SET
        "minutesPlayed" = user_daily_scores."minutesPlayed" + $4,
        "totalScore" = user_daily_scores."totalScore" + $4 +
          CASE
            WHEN user_daily_scores."minutesPlayed" < 1.00
             AND user_daily_scores."minutesPlayed" + $4 >= 1.00
            THEN ${scorePoints.ACTIVE_DAY_BONUS}
            ELSE 0
          END,
        "updatedAt" = NOW()
      RETURNING
        "date"::text AS "businessDate",
        "minutesPlayed" AS "minutesAfter",
        ("minutesPlayed" - $4 < 1.00 AND "minutesPlayed" >= 1.00) AS "crossedActiveThreshold"
      `,
      [userId, tenantId, normalizedDate, minutesToAdd],
    );

    const row = rows?.[0] ?? {};
    return {
      businessDate: row.businessDate ?? normalizedDate,
      minutesAfter: parseFloat(row.minutesAfter) || 0,
      crossedActiveThreshold: row.crossedActiveThreshold === true,
    };
  }

  /**
   * Increments totalScore by a specified amount (for reactions/comments).
   * Creates a new row if one doesn't exist for today (without active day bonus).
   */
  async incrementTotalScore(
    userId: number,
    tenantId: string,
    amount: number,
  ): Promise<void> {
    const normalizedDate = toBusinessDateString();

    await this.query(
      `
      INSERT INTO user_daily_scores ("id", "userId", "tenant_id", "date", "minutesPlayed", "totalScore", "createdAt", "updatedAt")
      VALUES (uuid_generate_v4(), $1, $2, $3::date, 0, $4, NOW(), NOW())
      ON CONFLICT ("userId", "tenant_id", "date")
      DO UPDATE SET
        "totalScore" = user_daily_scores."totalScore" + $4,
        "updatedAt" = NOW()
      `,
      [userId, tenantId, normalizedDate, amount],
    );
  }

  /**
   * Decrements totalScore by a specified amount.
   * Used when removing reactions/comments - decrements from today's score.
   * Creates a new row if one doesn't exist for today.
   */
  async decrementTotalScore(
    userId: number,
    tenantId: string,
    amount: number,
    em?: EntityManager,
  ): Promise<void> {
    const normalizedDate = toBusinessDateString();

    const userDailyScoreRepo = em
      ? em.getRepository(UserDailyScores)
      : this.dataSource.getRepository(UserDailyScores);
    await userDailyScoreRepo.query(
      `
      INSERT INTO user_daily_scores ("id", "userId", "tenant_id", "date", "minutesPlayed", "totalScore", "createdAt", "updatedAt")
      VALUES (uuid_generate_v4(), $1, $2, $3::date, 0, $4, NOW(), NOW())
      ON CONFLICT ("userId", "tenant_id", "date")
      DO UPDATE SET
        "totalScore" = user_daily_scores."totalScore" + $4,
        "updatedAt" = NOW()
      `,
      [userId, tenantId, normalizedDate, -amount],
    );
  }

  async getLeaderboardWithUserDetails(
    tenantId: string,
    startDate: Date,
    endDate: Date,
    pagination?: Pagination,
    hideRankInCommunity?: boolean,
  ): Promise<LeaderboardResult> {
    const limit = pagination?.limit ?? 50;
    const offset = pagination?.offset ?? 0;
    const businessToday = toBusinessDateString();

    const leaderboardData = await this.query(
      `
      WITH aggregated_scores AS (
        SELECT
          u.id as "userId",
          COALESCE(SUM(uds."minutesPlayed"), 0) as "minutesPlayed",
          COALESCE(SUM(uds."totalScore"), 0) as score
        FROM users u
        LEFT JOIN user_daily_scores uds
          ON uds."userId" = u.id
          AND uds."tenant_id" = $1
          AND uds."date" >= $2
          AND uds."date" <= $3
        WHERE u.tenant_id = $1
          AND u.status != 'SUSPENDED'
          AND EXISTS (
            SELECT 1
            FROM user_groups ug
            INNER JOIN groups g ON g.id = ug."groupId"
            WHERE ug."userId" = u.id AND g.name = 'LEARNER'
          )
        GROUP BY u.id
      ),
      ranked_scores AS (
        SELECT
          "userId",
          "minutesPlayed",
          score,
          RANK() OVER (ORDER BY score DESC) as rank
        FROM aggregated_scores
      ),
      -- Narrow to the requested page BEFORE the streak CTEs. Streaks are
      -- all-time, so without this the gaps-and-islands scan would run over every
      -- learner's full history; joining against the page bounds it to at most
      -- LIMIT users. Computing streaks per row instead would be an N+1.
      page AS (
        SELECT
          rs."userId",
          rs."minutesPlayed",
          rs.rank,
          u.name,
          u."profileImageUrl",
          u.status
        FROM ranked_scores rs
        JOIN users u ON u.id = rs."userId"
        ORDER BY rs.rank ASC, u.name ASC, rs."userId" ASC
        LIMIT $4 OFFSET $5
      ),
      active_days AS (
        SELECT DISTINCT uds."userId", uds."date"::date AS active_day
        FROM user_daily_scores uds
        JOIN page p ON p."userId" = uds."userId"
        WHERE uds.tenant_id = $1
          AND uds."minutesPlayed" >= 1.00
      ),
      islands AS (
        SELECT
          "userId",
          active_day,
          active_day - (ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY active_day))::int AS island
        FROM active_days
      ),
      runs AS (
        SELECT "userId", COUNT(*)::int AS run_length, MAX(active_day) AS last_day
        FROM islands
        GROUP BY "userId", island
      ),
      streaks AS (
        SELECT
          "userId",
          COALESCE(MAX(run_length) FILTER (WHERE last_day >= $6::date - 1), 0)::int AS current_streak
        FROM runs
        GROUP BY "userId"
      )
      SELECT
        p."userId",
        p."minutesPlayed",
        p.rank,
        p.name,
        p."profileImageUrl",
        p.status,
        COALESCE(bu.badge_count, 0) as "badgeCount",
        COALESCE(s.current_streak, 0) as "currentStreak"
      FROM page p
      LEFT JOIN (
        SELECT "userId", COUNT(*) as badge_count
        FROM badge_users
        WHERE badge_users."deletedAt" IS NULL
        GROUP BY "userId"
      ) bu ON bu."userId" = p."userId"
      LEFT JOIN streaks s ON s."userId" = p."userId"
      ORDER BY p.rank ASC, p.name ASC, p."userId" ASC
      `,
      [tenantId, startDate, endDate, limit, offset, businessToday],
    );

    const countResult = await this.query(
      `
      SELECT COUNT(*) as count
      FROM users u
      WHERE u.tenant_id = $1
        AND u.status != 'SUSPENDED'
        AND EXISTS (
          SELECT 1
          FROM user_groups ug
          INNER JOIN groups g ON g.id = ug."groupId"
          WHERE ug."userId" = u.id AND g.name = 'LEARNER'
        )
      `,
      [tenantId],
    );

    const totalCount = parseInt(countResult[0]?.count) || 0;

    const data: LeaderboardEntryDto[] = leaderboardData.map((row: any) => ({
      userId: row.userId,
      name: row.name,
      status: row.status,
      profileImageUrl: row.profileImageUrl || undefined,
      rank: hideRankInCommunity ? undefined : parseInt(row.rank) || 0,
      minutesPlayed: parseInt(row.minutesPlayed) || 0,
      badgeCount: parseInt(row.badgeCount) || 0,
      currentStreak: parseInt(row.currentStreak) || 0,
    }));

    return { data, totalCount };
  }

  async getUserRankWithDetails(
    userId: number,
    tenantId: string,
    startDate: Date,
    endDate: Date,
    hideRankInCommunity?: boolean,
  ): Promise<UserRankResult | null> {
    const result = await this.query(
      `
      WITH aggregated_scores AS (
        SELECT
          u.id as "userId",
          COALESCE(SUM(uds."minutesPlayed"), 0) as "minutesPlayed",
          COALESCE(SUM(uds."totalScore"), 0) as score
        FROM users u
        LEFT JOIN user_daily_scores uds
          ON uds."userId" = u.id
          AND uds."tenant_id" = $1
          AND uds."date" >= $2
          AND uds."date" <= $3
        WHERE u.tenant_id = $1
          AND u.status != 'SUSPENDED'
          AND EXISTS (
            SELECT 1
            FROM user_groups ug
            INNER JOIN groups g ON g.id = ug."groupId"
            WHERE ug."userId" = u.id AND g.name = 'LEARNER'
          )
        GROUP BY u.id
      ),
      ranked_scores AS (
        SELECT
          "userId",
          "minutesPlayed",
          score,
          RANK() OVER (ORDER BY score DESC) as rank
        FROM aggregated_scores
      )
      SELECT
        rs."userId",
        rs."minutesPlayed",
        rs.rank,
        u.name,
        u."profileImageUrl",
        u.status,
        COALESCE(bu.badge_count, 0) as "badgeCount"
      FROM ranked_scores rs
      JOIN users u ON u.id = rs."userId"
      LEFT JOIN (
        SELECT "userId", COUNT(*) as badge_count
        FROM badge_users
        WHERE badge_users."deletedAt" IS NULL
        GROUP BY "userId"
      ) bu ON bu."userId" = rs."userId"
      WHERE rs."userId" = $4
      `,
      [tenantId, startDate, endDate, userId],
    );

    if (result.length === 0) {
      return null;
    }

    // One user, so reuse the shared streak definition rather than duplicating
    // the CTE here — the leaderboard row and "my rank" must never disagree.
    const streaks = await this.getUserStreaks(userId, tenantId);

    const row = result[0];
    return {
      userId: row.userId,
      name: row.name,
      profileImageUrl: row.profileImageUrl || undefined,
      status: row.status,
      rank: hideRankInCommunity ? undefined : parseInt(row.rank) || 0,
      minutesPlayed: parseInt(row.minutesPlayed) || 0,
      badgeCount: parseInt(row.badgeCount) || 0,
      currentStreak: streaks.currentStreak,
    };
  }

  async getTotalSimulationMinutesPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; totalMinutes: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    const totalSimulationMinutesQuery = this.createQueryBuilder(
      'user_daily_score',
    )
      .andWhere('user_daily_score.minutesPlayed > 0')
      .select('user_daily_score.userId', 'userId')
      .addSelect('SUM(user_daily_score.minutesPlayed)', 'totalMinutes')
      .groupBy('user_daily_score.userId');

    if (userIds) {
      totalSimulationMinutesQuery.andWhere(
        'user_daily_score.userId IN (:...userIds)',
        {
          userIds,
        },
      );
    }
    if (tenantIds) {
      totalSimulationMinutesQuery.andWhere(
        'user_daily_score.tenantId IN (:...tenantIds)',
        {
          tenantIds,
        },
      );
    }

    const totalSimulationMinutesResult =
      await totalSimulationMinutesQuery.getRawMany();

    return totalSimulationMinutesResult.map((res) => ({
      userId: res.userId,
      totalMinutes: parseFloat(res.totalMinutes) || 0,
    }));
  }

  /**
   * Returns per-bucket practice minutes for a single user within [from, to],
   * grouped by day/week/month. Buckets with no activity are filled with 0 so the
   * heatmap is continuous. `unit` is a fixed 'day' | 'week' | 'month' literal
   * (never raw user input) and is bound safely into date_trunc.
   */
  async getPracticeMinutesByBucket(
    userId: number,
    tenantId: string,
    unit: 'day' | 'week' | 'month',
    from: Date,
    to: Date,
  ): Promise<{ bucket: string; minutes: number }[]> {
    const rows = await this.query(
      `
      WITH series AS (
        SELECT generate_series(
          date_trunc($3, $4::timestamp),
          date_trunc($3, $5::timestamp),
          ('1 ' || $3)::interval
        )::date AS bucket
      ),
      agg AS (
        SELECT
          date_trunc($3, "date")::date AS bucket,
          SUM("minutesPlayed") AS minutes
        FROM user_daily_scores
        WHERE "userId" = $1
          AND tenant_id = $2
          AND "date" >= $4
          AND "date" <= $5
        GROUP BY 1
      )
      SELECT
        to_char(s.bucket, 'YYYY-MM-DD') AS bucket,
        COALESCE(a.minutes, 0) AS minutes
      FROM series s
      LEFT JOIN agg a ON a.bucket = s.bucket
      ORDER BY s.bucket ASC
      `,
      [userId, tenantId, unit, from, to],
    );

    return rows.map((row: any) => ({
      bucket: row.bucket,
      minutes: parseFloat(row.minutes) || 0,
    }));
  }

  /**
   * Computes consecutive-active-days streak statistics for a set of users in a
   * single tenant, using the "gaps and islands" technique. An active day is one
   * where minutesPlayed >= 1.00.
   *
   * The current streak is the run whose most recent day is `businessToday` or the
   * day before (the day before is allowed so the streak is not shown as broken
   * before the user has practised on the current day).
   *
   * This is the single definition of "streak" — the API, the badge award path and
   * the leaderboard all read it. It runs set-wide over `userIds`, so callers must
   * never loop it per user.
   *
   * `businessToday` is a YYYY-MM-DD string computed in the business timezone by
   * the caller. It replaces CURRENT_DATE deliberately: CURRENT_DATE resolves in
   * the Postgres session timezone, which nothing in this repo sets.
   */
  async getStreakStatsForUsers(
    tenantId: string,
    userIds: number[] | undefined,
    businessToday: string,
  ): Promise<StreakStatsRow[]> {
    if (!tenantId) {
      return [];
    }
    // An explicitly empty list means "no users", which is different from
    // undefined ("every user in the tenant").
    if (userIds && !userIds.length) {
      return [];
    }

    const rows = await this.query(
      `
      WITH active_days AS (
        SELECT DISTINCT "userId", "date"::date AS active_day
        FROM user_daily_scores
        WHERE tenant_id = $1
          AND ($2::int[] IS NULL OR "userId" = ANY($2::int[]))
          AND "minutesPlayed" >= 1.00
      ),
      islands AS (
        SELECT
          "userId",
          active_day,
          active_day - (ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY active_day))::int AS island
        FROM active_days
      ),
      runs AS (
        SELECT
          "userId",
          island,
          COUNT(*)::int   AS run_length,
          MIN(active_day) AS first_day,
          MAX(active_day) AS last_day
        FROM islands
        GROUP BY "userId", island
      )
      SELECT
        "userId",
        COALESCE(MAX(run_length), 0)::int AS "longestStreak",
        COALESCE(MAX(run_length) FILTER (WHERE last_day >= $3::date - 1), 0)::int AS "currentStreak",
        to_char(MIN(first_day) FILTER (WHERE last_day >= $3::date - 1), 'YYYY-MM-DD') AS "streakStartDate",
        to_char(MAX(last_day), 'YYYY-MM-DD') AS "lastActiveDate",
        (ARRAY_AGG(run_length ORDER BY last_day DESC)
           FILTER (WHERE last_day < $3::date - 1))[1] AS "previousRunLength",
        to_char(MAX(last_day) FILTER (WHERE last_day < $3::date - 1), 'YYYY-MM-DD') AS "previousRunEndedOn"
      FROM runs
      GROUP BY "userId"
      `,
      [tenantId, userIds ?? null, businessToday],
    );

    return rows.map((row: any) => ({
      userId: Number(row.userId),
      currentStreak: parseInt(row.currentStreak) || 0,
      longestStreak: parseInt(row.longestStreak) || 0,
      streakStartDate: row.streakStartDate ?? null,
      lastActiveDate: row.lastActiveDate ?? null,
      previousRunLength: row.previousRunLength
        ? parseInt(row.previousRunLength)
        : null,
      previousRunEndedOn: row.previousRunEndedOn ?? null,
    }));
  }

  /**
   * Practice minutes a user has accumulated on one business day.
   *
   * Deliberately its own indexed single-row lookup rather than being read off
   * the heatmap cells: the cells only cover today when groupBy is DAY and the
   * requested range includes it, so deriving from them silently returns the
   * wrong number for WEEK/MONTH or an explicit past `to`.
   */
  async getMinutesOnDate(
    userId: number,
    tenantId: string,
    businessDate: string,
  ): Promise<number> {
    const rows = await this.query(
      `
      SELECT COALESCE("minutesPlayed", 0) AS minutes
      FROM user_daily_scores
      WHERE "userId" = $1 AND tenant_id = $2 AND "date" = $3::date
      `,
      [userId, tenantId, businessDate],
    );

    return parseFloat(rows?.[0]?.minutes) || 0;
  }

  /**
   * Convenience wrapper over {@link getStreakStatsForUsers} for a single user.
   * Users with no active days at all are absent from the query result, so this
   * returns a zeroed row rather than undefined.
   */
  async getUserStreaks(
    userId: number,
    tenantId: string,
    businessToday: string = toBusinessDateString(),
  ): Promise<StreakStatsRow> {
    const [row] = await this.getStreakStatsForUsers(
      tenantId,
      [userId],
      businessToday,
    );

    return (
      row ?? {
        userId,
        currentStreak: 0,
        longestStreak: 0,
        streakStartDate: null,
        lastActiveDate: null,
        previousRunLength: null,
        previousRunEndedOn: null,
      }
    );
  }
}
