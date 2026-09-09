import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Literal XP targets, one row per (grain, periodStart). `grain` is 'month' |
 * 'quarter' | 'year'; `periodStart` is the first day of that period (UTC),
 * e.g. 2026-01-01 for both Jan 2026 and Q1 2026.
 *
 * This migration only creates the (empty) table. A goal is a business
 * decision, not application state — there is deliberately no admin form for
 * it. Set real targets with a follow-up migration that INSERTs literal rows
 * (`ON CONFLICT ("grain", "periodStart") DO NOTHING`, matching the seeding
 * style of CreateAnalyticsQualityThresholds), once they are agreed. A period
 * with no row reads on the Goals chart as "no goal set", never as a zero
 * target.
 */
export class CreateAnalyticsXpGoals1959000000000 implements MigrationInterface {
  name = 'CreateAnalyticsXpGoals1959000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "analytics_xp_goals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "grain" character varying(10) NOT NULL,
        "periodStart" date NOT NULL,
        "targetXp" integer NOT NULL,
        CONSTRAINT "PK_analytics_xp_goals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "analytics_xp_goals_grain_period_uq"
        ON "analytics_xp_goals" ("grain", "periodStart")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "analytics_xp_goals_grain_period_uq"
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS "analytics_xp_goals"
    `);
  }
}
