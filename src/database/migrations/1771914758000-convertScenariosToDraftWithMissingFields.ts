import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertScenariosToDraftWithMissingFields1771914758000 implements MigrationInterface {
  name = 'ConvertScenariosToDraftWithMissingFields1771914758000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update scenarios to DRAFT status where status is ACTIVE and any of the following fields are null/missing:
    // 1. competencyId is NULL
    // 2. No behavior instructions exist (checking scenario_behavior_instructions where deletedAt IS NULL)
    // 3. stateInstructions is NULL, empty array, or doesn't exist in metadata
    await queryRunner.query(`
      UPDATE "scenarios"
      SET "status" = 'DRAFT'
      WHERE 
        "deletedAt" IS NULL
        AND "status" = 'ACTIVE'
        AND (
          "competencyId" IS NULL
          OR NOT EXISTS (
            SELECT 1 
            FROM "scenario_behavior_instructions" sbi
            WHERE sbi."scenarioId" = "scenarios"."id"
              AND sbi."deletedAt" IS NULL
          )
          OR "metadata" IS NULL
          OR NOT ("metadata" ? 'stateInstructions')
          OR "metadata"->>'stateInstructions' IS NULL
          OR COALESCE(jsonb_array_length("metadata"->'stateInstructions'), 0) = 0
        )
    `);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: We cannot restore the previous status without additional tracking
  }
}
