import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserProgress } from '../entity/user-progress.entity';

export interface ProgressTotals {
  totalXp: number;
  level: number;
  lastLevelUpAt: Date | null;
}

@Injectable()
export class UserProgressRepository extends Repository<UserProgress> {
  constructor(private dataSource: DataSource) {
    super(UserProgress, dataSource.createEntityManager());
  }

  /**
   * Adds XP to the rollup and returns the new totals.
   *
   * The increment is done in SQL rather than read-modify-write so two concurrent awards
   * for the same learner cannot lose one another. `level` is recomputed by the caller
   * from the returned total, because the ladder lives in code.
   */
  async addXp(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    xp: number,
    awardedAt: Date,
  ): Promise<{ totalXp: number; previousLevel: number }> {
    const rows: { totalXp: number; previousLevel: number }[] =
      await manager.query(
        `INSERT INTO "user_progress" ` +
          `("userId", "tenant_id", "totalXp", "level", "lastAwardedAt") ` +
          `VALUES ($1, $2, $3, 1, $4) ` +
          `ON CONFLICT ("userId", "tenant_id") DO UPDATE SET ` +
          `"totalXp" = "user_progress"."totalXp" + EXCLUDED."totalXp", ` +
          `"lastAwardedAt" = EXCLUDED."lastAwardedAt", ` +
          `"updatedAt" = now() ` +
          `RETURNING "totalXp", "level" AS "previousLevel"`,
        [userId, tenantId, xp, awardedAt],
      );

    return {
      totalXp: Number(rows[0].totalXp),
      previousLevel: Number(rows[0].previousLevel),
    };
  }

  /** Writes the recomputed level, stamping lastLevelUpAt only on an actual promotion. */
  async setLevel(
    manager: EntityManager,
    userId: number,
    tenantId: string,
    level: number,
    leveledUp: boolean,
    at: Date,
  ): Promise<void> {
    await manager.query(
      `UPDATE "user_progress" SET "level" = $3, "updatedAt" = now()` +
        (leveledUp ? `, "lastLevelUpAt" = $4` : '') +
        ` WHERE "userId" = $1 AND "tenant_id" = $2`,
      leveledUp ? [userId, tenantId, level, at] : [userId, tenantId, level],
    );
  }

  async findTotals(
    userId: number,
    tenantId: string,
  ): Promise<ProgressTotals | null> {
    const rows: {
      totalXp: number;
      level: number;
      lastLevelUpAt: Date | null;
    }[] = await this.query(
      `SELECT "totalXp", "level", "lastLevelUpAt" FROM "user_progress" ` +
        `WHERE "userId" = $1 AND "tenant_id" = $2 LIMIT 1`,
      [userId, tenantId],
    );

    if (!rows.length) return null;
    return {
      totalXp: Number(rows[0].totalXp),
      level: Number(rows[0].level),
      lastLevelUpAt: rows[0].lastLevelUpAt,
    };
  }
}
