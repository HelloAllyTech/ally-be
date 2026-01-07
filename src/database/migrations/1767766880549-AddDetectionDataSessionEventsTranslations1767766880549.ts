import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetectionDataSessionEventsTranslations1767766880549
  implements MigrationInterface
{
  name = 'AddDetectionDataSessionEventsTranslations1767766880549';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events_translations" ADD "detectionData" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events_translations" DROP COLUMN "detectionData"`,
    );
  }
}
