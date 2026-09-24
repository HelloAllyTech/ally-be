import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Literal monthly XP targets for Apr–Aug 2026, agreed with product.
 * Follow-up to `CreateAnalyticsXpGoals1959000000000`, which deliberately
 * ships no admin form for this — see that migration's header. `ON CONFLICT
 * DO NOTHING` so a re-run cannot clobber a target someone has since revised
 * with a later migration.
 */
export class SeedAnalyticsXpGoalsAprToAug20261971900000000 implements MigrationInterface {
  name = 'SeedAnalyticsXpGoalsAprToAug20261971900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "analytics_xp_goals" ("grain", "periodStart", "targetXp")
      VALUES
        ('month', '2026-04-01', 500),
        ('month', '2026-05-01', 500),
        ('month', '2026-06-01', 500),
        ('month', '2026-07-01', 5000),
        ('month', '2026-08-01', 5000)
      ON CONFLICT ("grain", "periodStart") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "analytics_xp_goals"
      WHERE ("grain", "periodStart") IN (
        ('month', '2026-04-01'),
        ('month', '2026-05-01'),
        ('month', '2026-06-01'),
        ('month', '2026-07-01'),
        ('month', '2026-08-01')
      )
    `);
  }
}
