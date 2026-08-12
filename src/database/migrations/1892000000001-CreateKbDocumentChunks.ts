import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retrievable passages of a corpus document.
 *
 * THIS TABLE'S `id` IS THE WEAVIATE OBJECT UUID. That is what makes a citation resolvable: the
 * bot's answer carries chunk ids, and the admin conversation log turns one back into the exact
 * words on the exact page by loading the row. It also makes every index write idempotent by
 * construction — no create-vs-update decision, no 409 path.
 *
 * Rows are immutable for a given (document_id, chunk_version, chunk_index): re-chunking writes a
 * NEW version rather than editing, so the text behind a citation cannot silently change under a
 * conversation that already quoted it. The unique index enforces that.
 *
 * `page_from`/`page_to` default to 0 rather than being nullable because a citation renderer reads
 * 0 as "not paginated" — a nullable int invites `p. null` reaching a worker.
 *
 * No FK to kb_documents. Chunks outlive an archived document deliberately (archiving drops the
 * vectors and keeps the rows so old citations still resolve), and a hard document delete is refused
 * at the API rather than cascaded here.
 */
export class CreateKbDocumentChunks1892000000001 implements MigrationInterface {
  name = 'CreateKbDocumentChunks1892000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kb_document_chunks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "document_id" uuid NOT NULL,
        "chunk_index" integer NOT NULL,
        "text" text NOT NULL,
        "char_start" integer NOT NULL DEFAULT 0,
        "char_end" integer NOT NULL DEFAULT 0,
        "page_from" integer NOT NULL DEFAULT 0,
        "page_to" integer NOT NULL DEFAULT 0,
        "section_path" text,
        "token_count" integer NOT NULL DEFAULT 0,
        "text_hash" character varying(64) NOT NULL DEFAULT '',
        "upload_status" character varying(16) NOT NULL DEFAULT 'pending',
        "upload_error" text,
        "chunk_version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kb_document_chunks" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_kb_document_chunks_doc_version_index"
        ON "kb_document_chunks" ("document_id", "chunk_version", "chunk_index")`,
    );
    // Reading order within the live version — the "what can the bot see" view and the indexing job.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_document_chunks_document"
        ON "kb_document_chunks" ("document_id", "chunk_version", "chunk_index")`,
    );
    // Resume after a partial index: find exactly the chunks that have not landed yet.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_kb_document_chunks_pending"
        ON "kb_document_chunks" ("document_id", "chunk_version")
        WHERE "upload_status" <> 'success'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_kb_document_chunks_pending"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_kb_document_chunks_document"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_kb_document_chunks_doc_version_index"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "kb_document_chunks"`);
  }
}
