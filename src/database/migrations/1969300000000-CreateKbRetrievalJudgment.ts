import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Labels for the retrieval log: one row per judged retrieval, one per judged candidate.
 *
 * `kb_retrievals` already records what came back and at what similarity. What it could not
 * record is whether any of it was useful, and similarity does not stand in for that — the
 * character corpus returned nothing for a query a stored document answered directly, and the
 * scores were all the log had to say about it.
 *
 * Two tables because there are two judged units, and the retrieval-level one is not derivable
 * from the passages: a retrieval that returned nothing has no passages at all, and that row —
 * carrying what the judge would have needed — is the most useful one in here, since a corpus
 * gap and a floor set too tight are indistinguishable from the counts alone.
 *
 * ON DELETE CASCADE from both, so the retention sweep that drops a retrieval drops its labels
 * with it. These tables grow per retrieval times per candidate, and this database has been
 * saturated once already by unbounded load.
 */
export class CreateKbRetrievalJudgment1969300000000 implements MigrationInterface {
  name = 'CreateKbRetrievalJudgment1969300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_retrieval_judgments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "retrieval_id" uuid NOT NULL,
        "sufficiency" character varying(16) NOT NULL,
        "missing" text,
        "passages_judged" integer NOT NULL DEFAULT 0,
        "passages_skipped" integer NOT NULL DEFAULT 0,
        "corpus" character varying(32) NOT NULL,
        "consumer" character varying(32) NOT NULL,
        "min_similarity" real NOT NULL,
        "returned_count" integer NOT NULL,
        "occurred_at" TIMESTAMP NOT NULL,
        "judge_model" character varying(64) NOT NULL,
        "judge_prompt_version" character varying(16) NOT NULL DEFAULT 'v1',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_retrieval_judgments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_retrieval_judgments_retrieval" FOREIGN KEY ("retrieval_id")
          REFERENCES "kb_retrievals"("id") ON DELETE CASCADE
      )
    `);

    // The resumability constraint: "already judged" means judged by THIS model and rubric, so
    // a re-judge under a new version lands alongside the old verdict and an interrupted
    // backfill costs only the retrievals in flight.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "kb_retrieval_judgments_judge_uq"
        ON "kb_retrieval_judgments" ("retrieval_id", "judge_model", "judge_prompt_version")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_judgments_retrieval_id"
        ON "kb_retrieval_judgments" ("retrieval_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_judgments_sufficiency"
        ON "kb_retrieval_judgments" ("sufficiency")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_judgments_consumer"
        ON "kb_retrieval_judgments" ("consumer")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_judgments_occurred_at"
        ON "kb_retrieval_judgments" ("occurred_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kb_retrieval_passage_judgments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "passage_id" uuid NOT NULL,
        "retrieval_id" uuid NOT NULL,
        "chunk_id" uuid NOT NULL,
        "document_id" uuid NOT NULL,
        "relevance" character varying(16) NOT NULL,
        "superficial_match" boolean NOT NULL DEFAULT false,
        "reasoning" text,
        "similarity" real NOT NULL,
        "outcome" character varying(32) NOT NULL,
        "pass" character varying(16) NOT NULL,
        "corpus" character varying(32) NOT NULL,
        "consumer" character varying(32) NOT NULL,
        "occurred_at" TIMESTAMP NOT NULL,
        "judge_model" character varying(64) NOT NULL,
        "judge_prompt_version" character varying(16) NOT NULL DEFAULT 'v1',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_retrieval_passage_judgments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kb_retrieval_passage_judgments_passage" FOREIGN KEY ("passage_id")
          REFERENCES "kb_retrieval_passages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kb_retrieval_passage_judgments_retrieval" FOREIGN KEY ("retrieval_id")
          REFERENCES "kb_retrievals"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "kb_retrieval_passage_judgments_judge_uq"
        ON "kb_retrieval_passage_judgments" (
          "passage_id", "judge_model", "judge_prompt_version")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passage_judgments_retrieval_id"
        ON "kb_retrieval_passage_judgments" ("retrieval_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passage_judgments_document_id"
        ON "kb_retrieval_passage_judgments" ("document_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passage_judgments_relevance"
        ON "kb_retrieval_passage_judgments" ("relevance")
    `);
    // The precision curve is a scan over (similarity, relevance) and nothing else.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passage_judgments_similarity"
        ON "kb_retrieval_passage_judgments" ("similarity")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passage_judgments_outcome"
        ON "kb_retrieval_passage_judgments" ("outcome")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrieval_passage_judgments_consumer"
        ON "kb_retrieval_passage_judgments" ("consumer")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "kb_retrieval_passage_judgments"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_retrieval_judgments"`);
  }
}
