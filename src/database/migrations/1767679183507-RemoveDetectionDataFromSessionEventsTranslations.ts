import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDetectionDataFromSessionEventsTranslations1767679183507
  implements MigrationInterface
{
  name = 'RemoveDetectionDataFromSessionEventsTranslations1767679183507';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events_translations" DROP COLUMN "detectionData"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events_translations" ADD "detectionData" jsonb`,
    );
  }
}
