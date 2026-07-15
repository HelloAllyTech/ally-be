import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay Studio v2 copilot conversation tables:
 *  - copilot_sessions — one copilot chat per spec-editing session;
 *    `lastMessageSeq` is the atomic per-session message counter.
 *  - copilot_messages — append-only transcript (no soft delete). `seq` is
 *    gapless and unique per session; jsonb columns capture tool calls/results
 *    and the RFC-6902 patches applied during the turn so aborted turns keep
 *    their applied patches on record.
 */
export class CreateRoleplayCopilotTables1812000000000 implements MigrationInterface {
  name = 'CreateRoleplayCopilotTables1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "copilot_sessions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'ACTIVE', "lastMessageSeq" integer NOT NULL DEFAULT 0, "metadata" jsonb, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_copilot_sessions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_copilot_sessions_spec_id" ON "copilot_sessions" ("specId") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "copilot_messages" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "seq" integer NOT NULL, "role" character varying NOT NULL, "content" text, "toolCalls" jsonb, "toolResults" jsonb, "specDiff" jsonb, "metadata" jsonb, "createdBy" integer, CONSTRAINT "PK_copilot_messages_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_copilot_messages_session_seq" ON "copilot_messages" ("sessionId", "seq")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_copilot_messages_session_id" ON "copilot_messages" ("sessionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_copilot_messages_session_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_copilot_messages_session_seq"`,
    );
    await queryRunner.query(`DROP TABLE "copilot_messages"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_copilot_sessions_spec_id"`,
    );
    await queryRunner.query(`DROP TABLE "copilot_sessions"`);
  }
}
