import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatSummaryAttempts1809000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chat_summary_attempts" (
        "id" SERIAL NOT NULL,
        "tenant_id" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "chatId" integer NOT NULL,
        "attemptNo" integer NOT NULL DEFAULT 1,
        "trigger" character varying(20) NOT NULL,
        "outcome" character varying(20) NOT NULL,
        "phaseReached" character varying(20),
        "failureStage" character varying(40),
        "failureReason" text,
        "sttProviderAssigned" character varying(40),
        "sttProviderSucceeded" character varying(40),
        "sttAttempts" jsonb,
        "summaryModel" character varying(80),
        "startedAt" TIMESTAMP,
        "endedAt" TIMESTAMP,
        "elapsedMs" integer,
        "correlationId" character varying,
        CONSTRAINT "PK_chat_summary_attempts" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chat_summary_attempts_chatId" ON "chat_summary_attempts" ("chatId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chat_summary_attempts_created" ON "chat_summary_attempts" ("createdAt")`,
    );

    await queryRunner.query(
      `ALTER TABLE "chats" ADD "firstAttemptStatus" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" ADD "firstFailureStage" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chats" DROP COLUMN "firstFailureStage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chats" DROP COLUMN "firstAttemptStatus"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_chat_summary_attempts_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_chat_summary_attempts_chatId"`,
    );
    await queryRunner.query(`DROP TABLE "chat_summary_attempts"`);
  }
}
