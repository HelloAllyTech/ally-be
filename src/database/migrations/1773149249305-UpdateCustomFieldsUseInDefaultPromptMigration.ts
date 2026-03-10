import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateCustomFieldsUseInDefaultPromptMigration1773149249305 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
    UPDATE scenarios
    SET metadata = jsonb_set(
        metadata,
        '{customFields}',
        (
            SELECT jsonb_agg(
                CASE
                    WHEN field ? 'useInDefaultPrompt'
                        THEN field
                    ELSE field || '{"useInDefaultPrompt": true}'::jsonb
                END
            )
            FROM jsonb_array_elements(metadata->'customFields') AS field
        )
    )
    WHERE metadata IS NOT NULL
    AND metadata->'customFields' IS NOT NULL
    AND jsonb_typeof(metadata->'customFields') = 'array';
  `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
    UPDATE scenarios
    SET metadata = jsonb_set(
        metadata,
        '{customFields}',
        (
            SELECT jsonb_agg(
                field - 'useInDefaultPrompt'
            )
            FROM jsonb_array_elements(metadata->'customFields') AS field
        )
    )
    WHERE metadata IS NOT NULL
    AND metadata->'customFields' IS NOT NULL
    AND jsonb_typeof(metadata->'customFields') = 'array';
  `);
  }
}
