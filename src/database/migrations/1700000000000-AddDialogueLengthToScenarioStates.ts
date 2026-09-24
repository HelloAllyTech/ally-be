import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDialogueLengthToScenarioStates1700000000000 implements MigrationInterface {
  name = 'AddDialogueLengthToScenarioStates1700000000000';

  // Guarded to non-empty arrays: some rows hold a scalar `states` (the
  // v1.139.2 release failed here with "cannot extract elements from a
  // scalar"), and an empty array makes jsonb_agg return NULL, which
  // jsonb_set would write over the whole `metadata` column.
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
        jsonb_typeof(metadata -> 'states') = 'array'
        AND metadata -> 'states' <> '[]'::jsonb;
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
        jsonb_typeof(metadata -> 'states') = 'array'
        AND metadata -> 'states' <> '[]'::jsonb;
    `);
  }
}
