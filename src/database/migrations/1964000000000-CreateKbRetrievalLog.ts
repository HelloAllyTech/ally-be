import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The retrieval log: one row per retrieval, one per candidate passage it considered.
 *
 * Built so retrieval's numbers can be chosen from data. The character corpus's similarity
 * floor was set to 0.5 by reasoning; the first real measurement of an unambiguous hit came
 * back 0.5056. Nothing in the system would have reported that the floor was one paraphrase
 * from rejecting a direct match, because nothing recorded what anything scored.
 *
 * `ON DELETE CASCADE` from passages to retrievals so a retention sweep deletes a retrieval
 * and its candidates in one statement rather than orphaning thousands of passage rows —
 * this table grows per retrieval times per candidate, and the production database has
 * already been saturated once by unbounded query load.
 */
export class CreateKbRetrievalLog1964000000000 implements MigrationInterface {
  name = 'CreateKbRetrievalLog1964000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_retrievals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "corpus" character varying(32) NOT NULL,
        "consumer" character varying(32) NOT NULL,
        "query" text NOT NULL,
        "character_topics" text array NOT NULL DEFAULT '{}',
        "tags" text array NOT NULL DEFAULT '{}',
        "min_similarity" real NOT NULL,
        "requested_limit" integer NOT NULL,
        "fetch_limit" integer NOT NULL,
        "preferred_document_count" integer NOT NULL,
        "rest_document_count" integer NOT NULL,
        "first_pass_hits" integer NOT NULL,
        "second_pass_hits" integer,
        "returned_count" integer NOT NULL,
        "latency_ms" integer NOT NULL,
        "session_id" uuid,
        "created_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_retrievals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_retrieval_passages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "retrieval_id" uuid NOT NULL,
        "chunk_id" uuid NOT NULL,
        "document_id" uuid NOT NULL,
        "rank" integer NOT NULL,
        "similarity" real NOT NULL,
        "pass" character varying(16) NOT NULL,
        "outcome" character varying(32) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_retrieval_passages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_retrieval_passages_retrieval" FOREIGN KEY ("retrieval_id")
          REFERENCES "kb_retrievals"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrievals_corpus" ON "kb_retrievals" ("corpus")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrievals_consumer" ON "kb_retrievals" ("consumer")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrievals_session_id" ON "kb_retrievals" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passages_retrieval_id" ON "kb_retrieval_passages" ("retrieval_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passages_document_id" ON "kb_retrieval_passages" ("document_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passages_similarity" ON "kb_retrieval_passages" ("similarity")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passages_outcome" ON "kb_retrieval_passages" ("outcome")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Passages first: the FK points that way, and IF EXISTS throughout so a partial `up`
    // rolls back cleanly rather than failing on the first missing object.
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_retrieval_passages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_retrievals"`);
  }
}
