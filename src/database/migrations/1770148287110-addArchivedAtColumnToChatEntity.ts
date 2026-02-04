import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddArchivedAtColumnToChatEntity1770148287110 implements MigrationInterface {
  name = 'AddArchivedAtColumnToChatEntity1770148287110';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" ADD "archivedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "archivedAt"`);
  }
}
