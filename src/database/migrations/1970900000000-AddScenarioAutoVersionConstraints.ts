import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two constraints for the daily auto-version job:
 *
 * 1. A real uniqueness guarantee behind the "one AUTOMATIC version per parent
 *    per day" rule, keyed on the calendar day of `createdAt` rather than the
 *    (renameable) `name` column, and NOT scoped to `deletedAt IS NULL` — a
 *    deleted or renamed auto-save must still block same-day recreation.
 * 2. An index supporting the candidate query the job runs against `scenarios`
 *    (status + updatedAt), so the daily scan isn't a full table scan.
 */
export class AddScenarioAutoVersionConstraints1970900000000 implements MigrationInterface {
  name = 'AddScenarioAutoVersionConstraints1970900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_scenario_versions_daily_auto_unique"
       ON "scenario_versions" ("scenarioId", "parentVersionId", "type", (date_trunc('day', "createdAt")))
       WHERE "type" = 'AUTOMATIC'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_scenarios_status_updated_at"
       ON "scenarios" ("status", "updatedAt")
       WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_scenarios_status_updated_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_scenario_versions_daily_auto_unique"`,
    );
  }
}
