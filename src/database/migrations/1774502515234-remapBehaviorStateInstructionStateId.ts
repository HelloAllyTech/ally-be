import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemapBehaviorStateInstructionStateId1774502515234 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            UPDATE "scenario_behavior_instructions" sbi
            SET "stateInstructions" = COALESCE(
              (
                SELECT jsonb_agg(
                         jsonb_build_object(
                           'stateId',
                           CASE (t.elem->>'stateId')
                             WHEN '1' THEN '-1'
                             WHEN '2' THEN '1'
                             WHEN '3' THEN '2'
                             WHEN '4' THEN '3'
                             ELSE t.elem->>'stateId'
                           END,
                           'instruction', t.elem->>'instruction'
                         ) ORDER BY t.ord
                       )
                FROM jsonb_array_elements(sbi."stateInstructions")
                  WITH ORDINALITY AS t(elem, ord)
              ),
              sbi."stateInstructions"
            )
            WHERE sbi."stateInstructions" IS NOT NULL
              AND jsonb_typeof(sbi."stateInstructions") = 'array'
              AND jsonb_array_length(sbi."stateInstructions") > 0
          `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            UPDATE "scenario_behavior_instructions" sbi
            SET "stateInstructions" = COALESCE(
              (
                SELECT jsonb_agg(
                         jsonb_build_object(
                           'stateId',
                           CASE (t.elem->>'stateId')
                             WHEN '-1' THEN '1'
                             WHEN '1' THEN '2'
                             WHEN '2' THEN '3'
                             WHEN '3' THEN '4'
                             ELSE t.elem->>'stateId'
                           END,
                           'instruction', t.elem->>'instruction'
                         ) ORDER BY t.ord
                       )
                FROM jsonb_array_elements(sbi."stateInstructions")
                  WITH ORDINALITY AS t(elem, ord)
              ),
              sbi."stateInstructions"
            )
            WHERE sbi."stateInstructions" IS NOT NULL
              AND jsonb_typeof(sbi."stateInstructions") = 'array'
              AND jsonb_array_length(sbi."stateInstructions") > 0
          `);
  }
}
