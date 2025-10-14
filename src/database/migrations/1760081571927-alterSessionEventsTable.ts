import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSessionEventsTable1760081571927
  implements MigrationInterface
{
  name = 'AlterSessionEventsTable1760081571927';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "detectionType" character varying NOT NULL DEFAULT 'SENTENCE_SIMILARITY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "visibilityType" character varying NOT NULL DEFAULT 'ACTIVE'`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "sentences" text array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "sentences"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "visibilityType"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "detectionType"`,
    );
  }
}
