import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * The progress module's outward face.
 *
 * BadgeModule needs a learner's level to decide which level badges they have earned, but
 * has no business reaching into the XP ledger or the rollup repository. This is the whole
 * of what leaves the module.
 */
@Injectable()
export class ProgressSharedService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Current level per learner, shaped like the other per-user count sources the badge
   * awarder consumes.
   *
   * Level is read from the stored column rather than recomputed from `totalXp`, because
   * the badge award has to agree with the level the learner was just told they reached.
   */
  async getLevelPerUser(
    tenantIds?: string[],
    userIds?: number[],
  ): Promise<{ userId: number; level: number }[]> {
    if (!tenantIds?.length && !userIds?.length) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (userIds?.length) {
      params.push(userIds);
      conditions.push(`"userId" = ANY($${params.length}::int[])`);
    }
    if (tenantIds?.length) {
      params.push(tenantIds);
      conditions.push(
        `"tenant_id" = ANY($${params.length}::character varying[])`,
      );
    }

    // A learner in more than one tenant has a row per tenant; the badge is global, so
    // the best standing is the one that counts.
    const rows: { userId: number; level: number }[] =
      await this.dataSource.query(
        `SELECT "userId", MAX("level")::int AS "level" FROM "user_progress" ` +
          `WHERE ${conditions.join(' AND ')} GROUP BY "userId"`,
        params,
      );

    return rows.map((row) => ({
      userId: Number(row.userId),
      level: Number(row.level),
    }));
  }
}
