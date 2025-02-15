import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessageType1739451971970 implements MigrationInterface {
  name = 'MessageType1739451971970';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "type" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "context" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "context"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "type"`);
  }
}
