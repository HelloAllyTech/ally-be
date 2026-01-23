import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTagsToSessionEvents1737377498000 implements MigrationInterface {
  name = 'AddTagsToSessionEvents1737377498000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session_events" ADD "tags" text[]`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session_events" DROP COLUMN "tags"`);
  }
}
