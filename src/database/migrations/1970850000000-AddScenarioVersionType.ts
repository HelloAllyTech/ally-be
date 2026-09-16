import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Distinguishes manually-authored scenario versions from the ones the daily
 * auto-version job creates from a modified draft. Existing rows predate the
 * job, so they backfill to MANUAL.
 */
export class AddScenarioVersionType1970850000000 implements MigrationInterface {
  name = 'AddScenarioVersionType1970850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "scenario_versions_type_enum" AS ENUM('MANUAL', 'AUTOMATIC')`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_versions" ADD COLUMN IF NOT EXISTS "type" "scenario_versions_type_enum" NOT NULL DEFAULT 'MANUAL'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_versions" DROP COLUMN IF EXISTS "type"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "scenario_versions_type_enum"`,
    );
  }
}
