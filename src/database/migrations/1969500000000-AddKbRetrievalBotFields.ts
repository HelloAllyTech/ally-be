import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make the retrieval log able to hold the WhatsApp bot's retrievals, and fence the query text
 * it brings with it.
 *
 * That path retrieves inside ally-ai and never passed through the service that writes this
 * table, so the platform's highest-volume RAG surface was the one nothing measured — and
 * `whatsapp_qa`'s similarity floor was therefore the one with the least evidence behind it.
 * ally-ai now emits its retrievals over the same SQS queue as llm_usage.
 *
 * `query_sensitive` is the reason this is a migration rather than four nullable columns. The
 * bot's query is a health worker's own question, so it is PHI-adjacent by default here, and
 * the flag is what lets every read surface withhold it WITHOUT having to know which consumers
 * are sensitive — a rule in data rather than a condition repeated in each caller.
 *
 * The `analytics_agent_kb_retrievals` view is the same fence for the Analytics Agent, whose
 * SQL is model-authored and could otherwise select the column inside an aggregate. It nulls
 * the query on sensitive rows and is what ALLOWED_TABLES points at, following the convention
 * every other tenant-filtered relation in that allowlist already uses.
 */
export class AddKbRetrievalBotFields1969500000000 implements MigrationInterface {
  name = 'AddKbRetrievalBotFields1969500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kb_retrievals"
        ADD COLUMN IF NOT EXISTS "decline_similarity" real,
        ADD COLUMN IF NOT EXISTS "disposition" character varying(40),
        ADD COLUMN IF NOT EXISTS "query_language" character varying(16),
        ADD COLUMN IF NOT EXISTS "query_sensitive" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kb_retrievals_disposition"
        ON "kb_retrievals" ("disposition")
    `);

    // Nulls the query on sensitive rows; everything else passes through. A view rather than a
    // denied column, so the agent keeps the qualitative reading for admin and agent queries —
    // which are not PHI — while never seeing a worker's question.
    await queryRunner.query(`
      CREATE OR REPLACE VIEW "analytics_agent_kb_retrievals" AS
      SELECT r.id,
             r.corpus,
             r.consumer,
             CASE WHEN r.query_sensitive THEN NULL ELSE r.query END AS query,
             r.query_sensitive,
             r.query_language,
             r.character_topics,
             r.tags,
             r.min_similarity,
             r.decline_similarity,
             r.disposition,
             r.requested_limit,
             r.fetch_limit,
             r.preferred_document_count,
             r.rest_document_count,
             r.first_pass_hits,
             r.second_pass_hits,
             r.returned_count,
             r.latency_ms,
             r.session_id,
             r.created_by,
             r."createdAt",
             r."updatedAt"
        FROM "kb_retrievals" r
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP VIEW IF EXISTS "analytics_agent_kb_retrievals"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_kb_retrievals_disposition"`,
    );
    await queryRunner.query(`
      ALTER TABLE "kb_retrievals"
        DROP COLUMN IF EXISTS "decline_similarity",
        DROP COLUMN IF EXISTS "disposition",
        DROP COLUMN IF EXISTS "query_language",
        DROP COLUMN IF EXISTS "query_sensitive"
    `);
  }
}
