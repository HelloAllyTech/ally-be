import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Month boards for the product roadmap: opportunities and bugs get a planned month and a
 * manual rank within it.
 *
 * NO BACKFILL, and that is the point. `boardPosition` DEFAULT 0 leaves every existing row tied,
 * so the board's ORDER BY falls through to priorityScore DESC and every lane is already sorted
 * by coins on day one. `plannedMonth` stays NULL, so every existing opportunity starts in the
 * Unscheduled lane and nothing is silently asserted about when it will ship — inventing a plan
 * from createdAt would be a guess the board would then present as a commitment.
 *
 * The CHECK is hand-written because TypeORM cannot see CHECK constraints: `migration:generate`
 * will not produce this one, and running it against this table would propose dropping the
 * existing CHK_roadmap_opps_* constraints entirely.
 */
export class AddRoadmapMonthBoard1902000000000 implements MigrationInterface {
  name = 'AddRoadmapMonthBoard1902000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD COLUMN "plannedMonth" character varying(7),
        ADD COLUMN "boardPosition" integer NOT NULL DEFAULT 0
    `);

    // Same pattern as CHK_roadmap_allocations_period: a month key is 'YYYY-MM' with a real
    // month, so '2026-13' and '26-01' are rejected by the database and not only by the DTO.
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        ADD CONSTRAINT "CHK_roadmap_opps_planned_month"
        CHECK ("plannedMonth" IS NULL OR "plannedMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    `);

    // Composite in lane order, so reading one month's cards is an index scan that comes back
    // already sorted. Partial on deletedAt to match every other index on this table.
    await queryRunner.query(`
      CREATE INDEX "idx_roadmap_opps_month_board"
        ON "roadmap_opportunities" ("plannedMonth", "boardPosition")
        WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_roadmap_opps_month_board"`);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_opps_planned_month"
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_opportunities"
        DROP COLUMN IF EXISTS "boardPosition",
        DROP COLUMN IF EXISTS "plannedMonth"
    `);
  }
}
