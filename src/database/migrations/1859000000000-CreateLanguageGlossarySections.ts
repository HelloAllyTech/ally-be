import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Language glossary (Indian languages) — foundation (LANGUAGE_GLOSSARY_DESIGN.md §4).
 *
 * `language_glossary_sections` — per-language "how to speak X" reference served to
 * the live agent. One row per (language, sectionCode[, organization]); the section's
 * `entries` jsonb holds typed entries (term_pair | rule | pattern) with per-entry
 * status/importance/provenance, and the prompt block is compiled from published
 * entries only — never hand-formatted text.
 *
 * - `injectionMode` is the tiering switch: 'always' sections compile into the
 *   Tier 0 style card injected into every turn's system prompt (token-capped at
 *   publish time); 'retrieved' sections join the knowledge-retrieval title
 *   selection with `retrievalHint` as their trigger description.
 * - `organizationId` is NULL for global rows (all rows in v1); reserved for
 *   per-org clinical terminology later. Uniqueness treats NULL as a sentinel via
 *   an expression index so duplicate global rows are impossible.
 */
export class CreateLanguageGlossarySections1859000000000 implements MigrationInterface {
  name = 'CreateLanguageGlossarySections1859000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "language_glossary_sections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "languageId" integer NOT NULL,
        "organizationId" uuid,
        "sectionCode" character varying(100) NOT NULL,
        "title" character varying(255) NOT NULL,
        "entries" jsonb NOT NULL DEFAULT '[]',
        "retrievalHint" text,
        "injectionMode" character varying(20) NOT NULL DEFAULT 'retrieved',
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "importance" integer,
        "provenance" jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "createdBy" character varying(255),
        "updatedBy" character varying(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_language_glossary_sections_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_language_glossary_sections_languageId" FOREIGN KEY ("languageId")
          REFERENCES "languages" ("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_language_glossary_language_section_org"
        ON "language_glossary_sections" ("languageId", "sectionCode",
          COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_language_glossary_language_status_mode"
        ON "language_glossary_sections" ("languageId", "status", "injectionMode")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_language_glossary_language_status_mode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."uq_language_glossary_language_section_org"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "language_glossary_sections"`,
    );
  }
}
