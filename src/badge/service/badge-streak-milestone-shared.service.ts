import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BadgeCategory, BadgeStatus } from '../constants/badge.constants';

export interface StreakMilestone {
  /** Streak length in days that unlocks this badge. */
  days: number;
  badgeId: string;
  badgeName: string;
  badgeImageUrl: string | null;
  /** Days still to go, always >= 1. */
  daysRemaining: number;
  /** True when the user already holds this badge from an earlier run. */
  alreadyEarned: boolean;
}

/**
 * Resolves the next ACTIVE_DAY_STREAK badge a user is working toward.
 *
 * Lives in the badge folder but is provided by CommunityModule, the same
 * arrangement TenantModule uses for BadgeTenantSharedService. BadgeModule
 * already imports CommunityModule and exports nothing, so a normal cross-module
 * injection would need forwardRef; this avoids the cycle entirely.
 */
@Injectable()
export class BadgeStreakMilestoneSharedService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The lowest visible streak threshold above `currentStreak`.
   *
   * Deliberately measured against the *current* streak rather than the longest
   * one, and deliberately not filtered to unawarded badges: a user who once hit
   * 30 days and is now on day 2 should be shown "7", not "60". `alreadyEarned`
   * lets the caller phrase it as a re-earn.
   *
   * Returns null when the tenant has no streak badges configured above the
   * user's current run — callers must hide the milestone rather than inventing
   * a threshold.
   */
  async getNextMilestone(
    userId: number,
    tenantId: string,
    currentStreak: number,
  ): Promise<StreakMilestone | null> {
    if (!userId || !tenantId) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
      SELECT
        b.id                                   AS "badgeId",
        b."name"                               AS "badgeName",
        b."imageUrl"                           AS "badgeImageUrl",
        (b."achievementParams"->>'count')::int AS "days",
        (bu.id IS NOT NULL)                    AS "alreadyEarned"
      FROM badges b
      JOIN badge_tenants bt
        ON bt."badgeId" = b.id
       AND bt."deletedAt" IS NULL
       AND bt."tenantId" = $2::uuid
      JOIN badge_groups bg
        ON bg."badgeId" = b.id
       AND bg."deletedAt" IS NULL
      JOIN user_groups ug
        ON ug."groupId" = bg."groupId"
       AND ug."userId" = $1::int
      LEFT JOIN badge_users bu
        ON bu."badgeId" = b.id
       AND bu."userId" = $1::int
       AND bu."deletedAt" IS NULL
      WHERE b."deletedAt" IS NULL
        AND b."status" = $4
        AND b."category" = $5
        AND (b."achievementParams"->>'count') IS NOT NULL
        AND (b."achievementParams"->>'count')::int > $3::int
      ORDER BY (b."achievementParams"->>'count')::int ASC, b.id ASC
      LIMIT 1
      `,
      [
        userId,
        tenantId,
        currentStreak,
        BadgeStatus.ACTIVE,
        BadgeCategory.ACTIVE_DAY_STREAK,
      ],
    );

    const row = rows?.[0];
    if (!row) {
      return null;
    }

    const days = Number(row.days);
    return {
      days,
      badgeId: row.badgeId,
      badgeName: row.badgeName,
      badgeImageUrl: row.badgeImageUrl ?? null,
      daysRemaining: Math.max(1, days - currentStreak),
      alreadyEarned: row.alreadyEarned === true,
    };
  }
}
