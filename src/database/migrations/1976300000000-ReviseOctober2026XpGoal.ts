import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Revises the Oct 2026 monthly XP target from 20,000 (seeded by
 * `SeedAnalyticsXpGoalsFy2027Q1Q31961000000000`) to 10,000, as agreed with
 * product. This is the "later migration" that seed's `ON CONFLICT DO NOTHING`
 * defers to — goals have no admin form, see `CreateAnalyticsXpGoals1959000000000`.
 *
 * An upsert rather than a bare UPDATE so the target lands even on a database
 * where the original row is missing. Quarter and year goals are summed from
 * month rows at read time, so Q3 FY2027 (Oct–Dec) follows without a row here.
 */
export class ReviseOctober2026XpGoal1976300000000 implements MigrationInterface {
  name = 'ReviseOctober2026XpGoal1976300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "analytics_xp_goals" ("grain", "periodStart", "targetXp")
      VALUES ('month', '2026-10-01', 10000)
      ON CONFLICT ("grain", "periodStart")
      DO UPDATE SET "targetXp" = EXCLUDED."targetXp", "updatedAt" = now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "analytics_xp_goals"
      SET "targetXp" = 20000, "updatedAt" = now()
      WHERE "grain" = 'month' AND "periodStart" = '2026-10-01'
    `);
  }
}
