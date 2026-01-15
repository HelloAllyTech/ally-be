import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParentMessageIdToMessages1750423161806 implements MigrationInterface {
  name = 'AddParentMessageIdToMessages1750423161806';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" ADD "parentMessageId" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "messages" DROP COLUMN "parentMessageId"`,
    );
  }
}
