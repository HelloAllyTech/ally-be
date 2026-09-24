import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDialogueLengthToScenarioStates1700000000000 implements MigrationInterface {
  name = 'AddDialogueLengthToScenarioStates1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios
      SET
        metadata = jsonb_set(
          metadata,
          '{states}',
          (
            SELECT
              jsonb_agg(
                state || '{"dialogueLength": null}'::jsonb
              )
            FROM
              jsonb_array_elements(metadata -> 'states') AS state
          )
        )
      WHERE
        metadata -> 'states' IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE scenarios
      SET
        metadata = jsonb_set(
          metadata,
          '{states}',
          (
            SELECT
              jsonb_agg(
                state - 'dialogueLength'
              )
            FROM
              jsonb_array_elements(metadata -> 'states') AS state
          )
        )
      WHERE
        metadata -> 'states' IS NOT NULL;
    `);
  }
}
