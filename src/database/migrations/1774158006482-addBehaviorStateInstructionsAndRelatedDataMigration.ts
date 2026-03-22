import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBehaviorStateInstructionsAndRelatedDataMigration1774158006482 implements MigrationInterface {
  name = 'AddBehaviorStateInstructionsAndRelatedDataMigration1774158006482';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_behavior_instructions" ADD "stateInstructions" jsonb`,
    );

    // Backfill stateInstructions from each scenario's metadata.stateInstructions
    // For each behavior instruction, copy the scenario's stateInstructions, keeping only {stateId, instruction}
    await queryRunner.query(`
      UPDATE "scenario_behavior_instructions" sbi
      SET "stateInstructions" = COALESCE(
        (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'stateId', si_elem->>'stateId',
                     'instruction', si_elem->>'instruction'
                   )
                 )
          FROM (
            SELECT jsonb_array_elements(s."metadata"->'stateInstructions') AS si_elem
            FROM "scenarios" s
            WHERE s."id" = sbi."scenarioId"
          ) src
        ),
        '[]'::jsonb
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_behavior_instructions" DROP COLUMN "stateInstructions"`,
    );
  }
}
