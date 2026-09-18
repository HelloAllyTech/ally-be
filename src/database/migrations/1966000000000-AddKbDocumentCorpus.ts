import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give every corpus document a `corpus`, so one ingest-and-retrieve pipeline can serve
 * more than one consumer.
 *
 * The pipeline never cared which consumer it was for — extraction, chunking, indexing,
 * retrieval and citation are identical whoever is asking. Only the material differs. The
 * WhatsApp Q&A bot was simply the first, so the table was named and documented for it;
 * the Character Library interview agent is the second.
 *
 * Every existing row IS WhatsApp material, so the column defaults to `whatsapp_qa` and the
 * backfill is the default doing its job. No row changes meaning, and retrieval for the
 * WhatsApp bot returns exactly what it returned before.
 *
 * Not an enum type: the values are read by application code that already validates them,
 * and a Postgres enum would need a migration to add the third consumer.
 */
export class AddKbDocumentCorpus1966000000000 implements MigrationInterface {
  name = 'AddKbDocumentCorpus1966000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD COLUMN "corpus" character varying(32) NOT NULL DEFAULT 'whatsapp_qa'`,
    );
    // Retrieval always filters by exactly one corpus, and the corpus table is listed per
    // corpus, so every read of this table carries it.
    await queryRunner.query(
      `CREATE INDEX "idx_kb_documents_corpus" ON "kb_documents" ("corpus")`,
    );

    // A curator's hint about which parts of a character a document grounds. Empty is the
    // default and a fine answer — retrieval treats it as a ranking boost, never a filter,
    // so an untagged corpus still retrieves normally.
    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD COLUMN "character_topics" text[] NOT NULL DEFAULT '{}'`,
    );
  }

  /**
   * IF EXISTS throughout: a down that fails partway leaves the database in a state
   * neither direction can leave, and these three drops are independent — there is no
   * value in the second failing because the first already happened.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP COLUMN IF EXISTS "character_topics"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_kb_documents_corpus"`);
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP COLUMN IF EXISTS "corpus"`,
    );
  }
}
