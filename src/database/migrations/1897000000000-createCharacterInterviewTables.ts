import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Character-library interview agent conversation tables (modeled on the
 * Roleplay Studio copilot tables, 1812000000000):
 *  - character_interview_sessions — one interview conversation per new
 *    character being authored; `lastMessageSeq` is the atomic per-session
 *    message counter, `draftCharacter` holds the generated profile once the
 *    agent calls save_character_draft (the human reviews it in the character
 *    form and the ordinary POST /v1/scenario-characters persists it).
 *  - character_interview_messages — append-only transcript (no soft delete).
 *    `seq` is gapless and unique per session; jsonb columns capture tool
 *    calls/results so a turn can be replayed into the Anthropic history.
 */
export class CreateCharacterInterviewTables1897000000000 implements MigrationInterface {
  name = 'CreateCharacterInterviewTables1897000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "character_interview_sessions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "status" character varying NOT NULL DEFAULT 'ACTIVE', "lastMessageSeq" integer NOT NULL DEFAULT 0, "draftCharacter" jsonb, "metadata" jsonb, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_character_interview_sessions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_character_interview_sessions_created_by" ON "character_interview_sessions" ("createdBy") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "character_interview_messages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "seq" integer NOT NULL, "role" character varying NOT NULL, "content" text, "toolCalls" jsonb, "toolResults" jsonb, "metadata" jsonb, "createdBy" integer, CONSTRAINT "PK_character_interview_messages_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_character_interview_messages_session_seq" ON "character_interview_messages" ("sessionId", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_character_interview_messages_session_id" ON "character_interview_messages" ("sessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_character_interview_messages_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_character_interview_messages_session_seq"`,
    );
    await queryRunner.query(`DROP TABLE "character_interview_messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_character_interview_sessions_created_by"`,
    );
    await queryRunner.query(`DROP TABLE "character_interview_sessions"`);
  }
}
