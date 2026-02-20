import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSummarizedMessageCountToChat1771568514352 implements MigrationInterface {
  name = 'AddSummarizedMessageCountToChat1771568514352';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_chats" ADD "summarizedMessageCount" integer NOT NULL DEFAULT '0'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_chats" DROP COLUMN "summarizedMessageCount"`,
    );
  }
}
