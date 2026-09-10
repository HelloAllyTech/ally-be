import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-organisation targeting for the WhatsApp Q&A corpus.
 *
 * `kb_documents` shipped with no tenant at all: the bot is open to anyone with the
 * number, so the corpus was global by construction. Documents are now targetable at
 * one, some or all organisations, using the same two-part shape the rest of the
 * platform's content already uses — an `isGlobal` flag on the row plus a
 * `*_tenants` join table (`scenario_tenants`, `track_tenants`, `case_tenants`).
 *
 * THE BACKFILL IS THE LOAD-BEARING PART. `is_global` defaults to false so a document
 * created by a caller that forgot the field reaches nobody rather than everybody — an
 * unreachable document is a visible bug, an over-shared one is invisible. But every
 * document that already exists WAS global, because that was the only thing a document
 * could be, so the existing rows are set to true explicitly. Without that, shipping the
 * retrieval filter would take the entire live corpus out of retrieval at once and every
 * worker's question would come back "my reference material does not cover that".
 * ally-ai's migration 005 makes the same statement about the vectors it holds, so the
 * two stores agree without either having to read the other.
 *
 * The unique index is PARTIAL on `deletedAt IS NULL`, so re-granting an organisation
 * that was previously removed inserts a fresh row rather than colliding with the
 * soft-deleted one — the same reason the cohort tables index that way.
 */
export class AddKbDocumentAudience1963000000000 implements MigrationInterface {
  name = 'AddKbDocumentAudience1963000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD "is_global" boolean NOT NULL DEFAULT false`,
    );

    // Every pre-existing document was global. Stated as an UPDATE rather than as the
    // column default so that new documents still default to closed.
    await queryRunner.query(`UPDATE "kb_documents" SET "is_global" = true`);

    await queryRunner.query(
      `CREATE INDEX "idx_kb_documents_is_global" ON "kb_documents" ("is_global")`,
    );

    await queryRunner.query(
      `CREATE TABLE "kb_document_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_kb_document_tenants_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kb_document_tenants_document" ON "kb_document_tenants" ("document_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kb_document_tenants_tenant" ON "kb_document_tenants" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_kb_document_tenants_document_tenant" ON "kb_document_tenants" ("document_id", "tenant_id") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_kb_document_tenants_document_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_kb_document_tenants_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_kb_document_tenants_document"`,
    );
    await queryRunner.query(`DROP TABLE "kb_document_tenants"`);
    await queryRunner.query(`DROP INDEX "public"."idx_kb_documents_is_global"`);
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP COLUMN "is_global"`,
    );
  }
}
