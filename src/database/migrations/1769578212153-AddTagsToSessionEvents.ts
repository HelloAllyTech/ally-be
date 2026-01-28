import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTagsToSessionEvents1769578212153 implements MigrationInterface {
  name = 'AddTagsToSessionEvents1769578212153';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "tags" text array`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session_events" DROP COLUMN "tags"`);
  }
}
