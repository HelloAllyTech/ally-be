import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserDailyScores } from '../entity/user-daily-scores.entity';
import { Pagination } from 'src/common/type/common.type';
import { LeaderboardEntryDto } from '../dto/leaderboard.dto';
import { LeaderboardResult, UserRankResult } from '../type/leaderboard.type';
import { scorePoints } from '../constant/community.constant';

@Injectable()
export class UserDailyScoreRepository extends Repository<UserDailyScores> {
  constructor(private dataSource: DataSource) {
    super(UserDailyScores, dataSource.createEntityManager());
  }

  /**
   * Upserts daily score for play time.
   * Awards: minutesToAdd points + 1 active day bonus (when minutesPlayed reaches >= 1)
   * Active day bonus is awarded only when cumulative minutesPlayed crosses the 1 minute threshold
   */
  async upsertDailyScore(
    userId: number,
    tenantId: string,
    date: Date,
    minutesToAdd: number,
  ): Promise<void> {
    const normalizedDate = new Date(date.toISOString().split('T')[0]);

    await this.query(
      `
      INSERT INTO user_daily_scores ("id", "userId", "tenant_id", "date", "minutesPlayed", "totalScore", "createdAt", "updatedAt")
      VALUES (
        uuid_generate_v4(), $1, $2, $3, $4, 
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
      `,
      [userId, tenantId, normalizedDate, minutesToAdd],
    );
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
    const normalizedDate = new Date(new Date().toISOString().split('T')[0]);

    await this.query(
      `
      INSERT INTO user_daily_scores ("id", "userId", "tenant_id", "date", "minutesPlayed", "totalScore", "createdAt", "updatedAt")
      VALUES (uuid_generate_v4(), $1, $2, $3, 0, $4, NOW(), NOW())
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
    const normalizedDate = new Date(new Date().toISOString().split('T')[0]);

    const userDailyScoreRepo = em
      ? em.getRepository(UserDailyScores)
      : this.dataSource.getRepository(UserDailyScores);
    await userDailyScoreRepo.query(
      `
      INSERT INTO user_daily_scores ("id", "userId", "tenant_id", "date", "minutesPlayed", "totalScore", "createdAt", "updatedAt")
      VALUES (uuid_generate_v4(), $1, $2, $3, 0, $4, NOW(), NOW())
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
      ORDER BY rs.rank ASC, u.name ASC, rs."userId" ASC
      LIMIT $4 OFFSET $5
      `,
      [tenantId, startDate, endDate, limit, offset],
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

    const row = result[0];
    return {
      userId: row.userId,
      name: row.name,
      profileImageUrl: row.profileImageUrl || undefined,
      status: row.status,
      rank: hideRankInCommunity ? undefined : parseInt(row.rank) || 0,
      minutesPlayed: parseInt(row.minutesPlayed) || 0,
      badgeCount: parseInt(row.badgeCount) || 0,
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

  async getMaxActiveDaysPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; maxStreak: number }[]> {
    if (!tenantIds?.length && !userIds?.length) {
      return [];
    }

    // Only count active days when minutesPlayed is greater than or equal to 1.00
    const conditions: string[] = ['"minutesPlayed" >= 1.00'];
    const params: any[] = [];
    let paramIndex = 1;

    if (userIds?.length) {
      conditions.push(
        `"userId" IN (${userIds.map(() => `$${paramIndex++}`).join(', ')})`,
      );
      params.push(...userIds);
    }
    if (tenantIds?.length) {
      conditions.push(
        `tenant_id IN (${tenantIds.map(() => `$${paramIndex++}`).join(', ')})`,
      );
      params.push(...tenantIds);
    }

    const whereClause = conditions.join(' AND ');
    const maxStreakResult = await this.query(
      `
      WITH active_days AS (
        SELECT 
          "userId", 
          "date" as active_day
        FROM user_daily_scores
        WHERE ${whereClause}
      ),
      islands AS (
        SELECT 
          "userId",
          active_day,
          active_day - (ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY active_day))::int as island
        FROM active_days
      ),
      streak_length AS (
        SELECT
          "userId",
          COUNT(*) as streak_length
        FROM islands
        GROUP BY 
        "userId", 
        island
      )
      SELECT 
        "userId",
        MAX(streak_length) as "maxStreak"
      FROM streak_length
      GROUP BY "userId"
      `,
      params,
    );

    return maxStreakResult.map((res: any) => ({
      userId: res.userId,
      maxStreak: parseInt(res.maxStreak) || 0,
    }));
  }
}
