import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSessionEventsTranslationsSequence1765447561001
  implements MigrationInterface
{
  name = 'AlterSessionEventsTranslationsSequence1765447561001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP SEQUENCE IF EXISTS session_events_translations_id_seq`,
    );

    await queryRunner.query(
      `ALTER TABLE session_events_translations ALTER COLUMN id SET DEFAULT nextval('session_events_translations_id_seq')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert the changes if needed
    await queryRunner.query(
      `ALTER TABLE session_events_translations ALTER COLUMN id DROP DEFAULT`,
    );
  }
}
