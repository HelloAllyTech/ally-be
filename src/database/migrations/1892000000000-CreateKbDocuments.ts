import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Knowledge corpus for the WhatsApp Q&A bot — the system of record.
 *
 * ally-ai's `KnowledgeChunk` Weaviate collection is a DERIVED index over the chunks of these rows
 * (same ownership rule as reference documents and roadmap opportunities), so everything here can
 * rebuild the vector side but never the other way round.
 *
 * NO tenant column, deliberately. The bot is open to anyone with the WhatsApp number, so there is
 * no tenant to scope by and the corpus is global. A future private per-tenant corpus should be a
 * separate collection rather than a filter over this one — retrieval that forgets a filter leaks.
 *
 * `raw_text` holds the full extracted text and is kept on purpose: chunk char offsets index into
 * it, so a citation resolves to an exact span, and re-chunking never has to re-parse the original
 * PDF (the slowest, most failure-prone step, whose S3 object may since have been removed).
 */
export class CreateKbDocuments1892000000000 implements MigrationInterface {
  name = 'CreateKbDocuments1892000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kb_documents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" text NOT NULL,
        "source_type" character varying(16) NOT NULL DEFAULT 'paste',
        "source_url" text,
        "file_url" text,
        "file_name" text,
        "content_type" character varying(128),
        "size_bytes" bigint,
        "raw_text" text NOT NULL DEFAULT '',
        "language" character varying(16),
        "tags" text array NOT NULL DEFAULT '{}',
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "status_message" text,
        "chunk_count" integer NOT NULL DEFAULT 0,
        "indexed_chunk_count" integer NOT NULL DEFAULT 0,
        "content_hash" character varying(64) NOT NULL DEFAULT '',
        "chunk_version" integer NOT NULL DEFAULT 1,
        "archived_at" TIMESTAMP,
        "created_by" integer NOT NULL,
        "updated_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_documents" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_documents_title"
        ON "kb_documents" ("title")`,
    );
    // The admin list filters by status constantly (and the ingest consumer looks up in-progress
    // documents), so status is indexed alongside recency.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_documents_status"
        ON "kb_documents" ("status", "createdAt" DESC)`,
    );
    // Partial index: the default list view excludes archived rows, and they are expected to
    // accumulate over time.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_documents_active"
        ON "kb_documents" ("createdAt" DESC) WHERE "archived_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_kb_documents_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_kb_documents_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_kb_documents_title"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_documents"`);
  }
}
