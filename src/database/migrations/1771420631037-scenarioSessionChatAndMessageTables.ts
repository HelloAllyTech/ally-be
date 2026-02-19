import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScenarioSessionChatAndMessageTables1771420631037 implements MigrationInterface {
  name = 'ScenarioSessionChatAndMessageTables1771420631037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_session_chats" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioSessionId" uuid NOT NULL, "userId" integer NOT NULL, "summary" text, CONSTRAINT "PK_bcfba9b89904b96815d134e6ff0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_session_chats_scenario_session_id_user_id_idx" ON "scenario_session_chats" ("scenarioSessionId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_session_chat_messages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "tenant_id" character varying NOT NULL, "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatId" uuid NOT NULL, "senderId" integer NOT NULL, "content" text NOT NULL, CONSTRAINT "PK_5464af06ce9c61c21764f49aa76" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_session_chat_messages_chat_id" ON "scenario_session_chat_messages" ("chatId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_session_chat_messages_chat_id"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_chat_messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_scenario_session_chats_scenario_session_id_user_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_session_chats"`);
  }
}
