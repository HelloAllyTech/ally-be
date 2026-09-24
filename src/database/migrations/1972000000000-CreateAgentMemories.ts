import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The notebook an Ally agent keeps — see `AgentMemory` and
 * docs/bug-hunter-memory-adr.md (OPP-0739 prototype, OPP-0714 builds on it).
 *
 * One table for every agent, scoped by `agent`. Postgres is the system of
 * record; semantic search runs over ally-ai's derived `AgentMemory` Weaviate
 * collection (ally-ai migration 007), which holds vectors and no text.
 *
 * Four CHECK constraints: the three enum columns, per repo convention, and the
 * 600-character cap on `body` — the product lead's rule that an entry is a
 * notebook line, not a document, made a database fact rather than a service
 * courtesy. Hand-written SQL, never `migration:generate`. Extending an enum
 * means redefining its constraint here AND adding to
 * `check-constraints-cover-enums.spec.ts`.
 *
 * Builder's `builder_lessons` rows are NOT moved here yet. They will be, with
 * `agent = 'builder'`, once Builder's knowledge service reads this table
 * (OPP-0714); moving data before the reader exists would leave Builder blind.
 */
export class CreateAgentMemories1972000000000 implements MigrationInterface {
  name = 'CreateAgentMemories1972000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agent_memories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agent" character varying NOT NULL,
        "body" text NOT NULL,
        "repos" jsonb,
        "tags" jsonb,
        "status" character varying NOT NULL DEFAULT 'active',
        "pinned" boolean NOT NULL DEFAULT false,
        "source_count" integer NOT NULL DEFAULT 1,
        "times_applied" integer NOT NULL DEFAULT 0,
        "times_contradicted" integer NOT NULL DEFAULT 0,
        "merged_into_id" uuid,
        "run_id" uuid,
        "finding_id" uuid,
        "created_by" integer,
        "last_applied_at" TIMESTAMP,
        "embedding_status" character varying NOT NULL DEFAULT 'pending',
        "embedding_attempts" integer NOT NULL DEFAULT 0,
        "embedded_at" TIMESTAMP,
        "text_hash" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_memories" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_memories_agent"
          CHECK ("agent" IN ('bug_hunter', 'builder')),
        CONSTRAINT "CHK_agent_memories_status"
          CHECK ("status" IN ('candidate', 'active', 'merged', 'retired')),
        CONSTRAINT "CHK_agent_memories_embedding_status"
          CHECK ("embedding_status" IN ('pending', 'success', 'failed', 'skipped')),
        CONSTRAINT "CHK_agent_memories_body_length"
          CHECK (char_length("body") BETWEEN 1 AND 600)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_agent_memories_agent_status" ON "agent_memories" ("agent", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_memories_embedding_status" ON "agent_memories" ("embedding_status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_memories"`);
  }
}
