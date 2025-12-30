import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByAndUpdatedByInSessionEvents1764240370455
  implements MigrationInterface
{
  name = 'AddCreatedByAndUpdatedByInSessionEvents1764240370455';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "createdBy" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "updatedBy" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "updatedBy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "createdBy"`,
    );
  }
}
