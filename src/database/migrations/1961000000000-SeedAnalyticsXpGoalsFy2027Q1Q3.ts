import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Literal monthly XP targets for Sep 2026 – Mar 2027, agreed with product.
 * Follow-up to `CreateAnalyticsXpGoals1959000000000`, which deliberately
 * ships no admin form for this — see that migration's header. `ON CONFLICT
 * DO NOTHING` so a re-run cannot clobber a target someone has since revised
 * with a later migration.
 */
export class SeedAnalyticsXpGoalsFy2027Q1Q31961000000000 implements MigrationInterface {
  name = 'SeedAnalyticsXpGoalsFy2027Q1Q31961000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "analytics_xp_goals" ("grain", "periodStart", "targetXp")
      VALUES
        ('month', '2026-09-01', 7500),
        ('month', '2026-10-01', 20000),
        ('month', '2026-11-01', 30000),
        ('month', '2026-12-01', 50000),
        ('month', '2027-01-01', 50000),
        ('month', '2027-02-01', 75000),
        ('month', '2027-03-01', 75000)
      ON CONFLICT ("grain", "periodStart") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "analytics_xp_goals"
      WHERE ("grain", "periodStart") IN (
        ('month', '2026-09-01'),
        ('month', '2026-10-01'),
        ('month', '2026-11-01'),
        ('month', '2026-12-01'),
        ('month', '2027-01-01'),
        ('month', '2027-02-01'),
        ('month', '2027-03-01')
      )
    `);
  }
}
