import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Denormalizes the session's `scenarioVersionId` onto every drift-judgment turn
 * row (mirrors the existing language / scenarioId / promptVersion columns), so
 * the conversation-drift dashboard can filter and compare drift by scenario
 * version with a single-table query. Backfills existing rows from
 * scenario_sessions; new rows are written by DriftJudgeRepository.upsertJudgments.
 */
export class AddScenarioVersionToDriftJudgment1789000000000 implements MigrationInterface {
  name = 'AddScenarioVersionToDriftJudgment1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "turn_drift_judgment" ADD COLUMN IF NOT EXISTS "scenarioVersionId" uuid`,
    );
    // Backfill from the session that produced each judgment.
    await queryRunner.query(
      `UPDATE "turn_drift_judgment" j
          SET "scenarioVersionId" = s."scenarioVersionId"
         FROM "scenario_sessions" s
        WHERE s.id = j."scenarioSessionId"
          AND j."scenarioVersionId" IS NULL
          AND s."scenarioVersionId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "turn_drift_judgment_scenario_version_id_idx"
         ON "turn_drift_judgment" ("scenarioVersionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "turn_drift_judgment_scenario_version_id_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "turn_drift_judgment" DROP COLUMN IF EXISTS "scenarioVersionId"`,
    );
  }
}
