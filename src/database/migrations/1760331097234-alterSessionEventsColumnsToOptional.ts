import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSessionEventsColumnsToOptional1760331097234
  implements MigrationInterface
{
  name = 'AlterSessionEventsColumnsToOptional1760331097234';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "description" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "score" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "emoji" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "message" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "message" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "emoji" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "score" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ALTER COLUMN "description" SET NOT NULL`,
    );
  }
}
