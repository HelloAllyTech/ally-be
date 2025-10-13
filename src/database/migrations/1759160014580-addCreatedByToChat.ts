import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCreatedByToChat1759160014580 implements MigrationInterface {
  name = 'AddCreatedByToChat1759160014580';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" ADD "createdBy" integer`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN "createdBy"`);
  }
}
