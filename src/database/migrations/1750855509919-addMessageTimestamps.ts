import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageTimestamps1750855509919 implements MigrationInterface {
  name = 'AddMessageTimestamps1750855509919';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" ADD "startedAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "messages" ADD "endedAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "endedAt"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "startedAt"`);
  }
}
