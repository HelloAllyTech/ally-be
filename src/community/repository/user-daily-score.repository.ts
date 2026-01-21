import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { UserDailyScores } from '../entity/user-daily-scores.entity';
import { Pagination } from 'src/common/type/common.type';
import { LeaderboardEntryDto } from '../dto/leaderboard.dto';
import { LeaderboardResult, UserRankResult } from '../type/leaderboard.type';

@Injectable()
export class UserDailyScoreRepository extends Repository<UserDailyScores> {
  constructor(private dataSource: DataSource) {
    super(UserDailyScores, dataSource.createEntityManager());
  }

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
      VALUES (uuid_generate_v4(), $1, $2, $3, $4, $4 + 1, NOW(), NOW())
      ON CONFLICT ("userId", "tenant_id", "date")
      DO UPDATE SET
        "minutesPlayed" = user_daily_scores."minutesPlayed" + $4,
        "totalScore" = user_daily_scores."minutesPlayed" + $4 + 1,
        "updatedAt" = NOW()
      `,
      [userId, tenantId, normalizedDate, minutesToAdd],
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
          "userId",
          SUM("minutesPlayed") as "minutesPlayed",
          SUM("totalScore") as score
        FROM user_daily_scores
        WHERE "tenant_id" = $1
          AND "date" >= $2
          AND "date" <= $3
        GROUP BY "userId"
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
        COALESCE(bu.badge_count, 0) as "badgeCount"
      FROM ranked_scores rs
      JOIN users u ON u.id = rs."userId"
      LEFT JOIN (
        SELECT "userId", COUNT(*) as badge_count
        FROM badge_users
        GROUP BY "userId"
      ) bu ON bu."userId" = rs."userId"
      ORDER BY rs.rank ASC
      LIMIT $4 OFFSET $5
      `,
      [tenantId, startDate, endDate, limit, offset],
    );

    const countResult = await this.query(
      `
      SELECT COUNT(DISTINCT "userId") as count
      FROM user_daily_scores
      WHERE "tenant_id" = $1
        AND "date" >= $2
        AND "date" <= $3
      `,
      [tenantId, startDate, endDate],
    );

    const totalCount = parseInt(countResult[0]?.count) || 0;

    const data: LeaderboardEntryDto[] = leaderboardData.map((row: any) => ({
      userId: row.userId,
      name: row.name,
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
          "userId",
          SUM("minutesPlayed") as "minutesPlayed",
          SUM("totalScore") as score
        FROM user_daily_scores
        WHERE "tenant_id" = $1
          AND "date" >= $2
          AND "date" <= $3
        GROUP BY "userId"
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
        COALESCE(bu.badge_count, 0) as "badgeCount"
      FROM ranked_scores rs
      JOIN users u ON u.id = rs."userId"
      LEFT JOIN (
        SELECT "userId", COUNT(*) as badge_count
        FROM badge_users
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
      rank: hideRankInCommunity ? undefined : parseInt(row.rank) || 0,
      minutesPlayed: parseInt(row.minutesPlayed) || 0,
      badgeCount: parseInt(row.badgeCount) || 0,
    };
  }

  async getUserDetailsForNoActivity(
    userId: number,
  ): Promise<{ name: string; profileImageUrl?: string; badgeCount: number }> {
    const result = await this.query(
      `
      SELECT 
        u.name,
        u."profileImageUrl",
        COALESCE(bu.badge_count, 0) as "badgeCount"
      FROM users u
      LEFT JOIN (
        SELECT "userId", COUNT(*) as badge_count
        FROM badge_users
        GROUP BY "userId"
      ) bu ON bu."userId" = u.id
      WHERE u.id = $1
      `,
      [userId],
    );

    if (result.length === 0) {
      return { name: '', profileImageUrl: undefined, badgeCount: 0 };
    }

    const row = result[0];
    return {
      name: row.name,
      profileImageUrl: row.profileImageUrl || null,
      badgeCount: parseInt(row.badgeCount) || 0,
    };
  }
}
