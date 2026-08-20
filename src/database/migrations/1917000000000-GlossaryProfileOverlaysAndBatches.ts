import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Profile-scoped glossary overlays + consolidation batches (the RSI loop):
 *
 * - language_glossary_sections.profileId — NULL = global row (unchanged
 *   semantics); non-NULL scopes the section to a language_variety_profiles
 *   row. Runtime serves global + the session profile's overlays, overlay
 *   winning on sectionCode. Uniqueness for overlay rows mirrors the global
 *   expression index: one (languageId, sectionCode) per profile.
 *
 * - glossary_consolidation_batches — one row per consolidation run, recording
 *   every entry it created (and auto-accepted), so an auto-accepted batch can
 *   be rolled back as a unit when attribution shows a regression.
 */
export class GlossaryProfileOverlaysAndBatches1917000000000 implements MigrationInterface {
  name = 'GlossaryProfileOverlaysAndBatches1917000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_glossary_sections" ADD COLUMN IF NOT EXISTS "profileId" uuid`,
    );
    // The 1859 uniqueness (languageId, sectionCode, org-sentinel) predates
    // overlays and would reject an overlay row sharing its global
    // counterpart's sectionCode — rescope it to global rows only; overlay
    // uniqueness is the per-profile index below.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_language_glossary_language_section_org"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_language_glossary_language_section_org"
        ON "language_glossary_sections" ("languageId", "sectionCode",
          COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'))
        WHERE "profileId" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_language_glossary_profile" ` +
        `ON "language_glossary_sections" ("profileId") WHERE "profileId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_language_glossary_language_section_profile" ` +
        `ON "language_glossary_sections" ("languageId", "sectionCode", "profileId") ` +
        `WHERE "profileId" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "glossary_consolidation_batches" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"languageId" integer NOT NULL, ` +
        `"status" character varying(20) NOT NULL DEFAULT 'active', ` +
        `"autoAccepted" boolean NOT NULL DEFAULT false, ` +
        `"trigger" character varying(20) NOT NULL DEFAULT 'manual', ` +
        `"stats" jsonb, ` +
        `"entries" jsonb NOT NULL DEFAULT '[]', ` +
        `"createdBy" character varying(255), ` +
        `CONSTRAINT "PK_glossary_consolidation_batches" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_glossary_batches_language" ` +
        `ON "glossary_consolidation_batches" ("languageId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "glossary_consolidation_batches"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_language_glossary_language_section_profile"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_language_glossary_profile"`,
    );
    await queryRunner.query(
      `ALTER TABLE "language_glossary_sections" DROP COLUMN IF EXISTS "profileId"`,
    );
    // Restore the unpartial 1859 uniqueness.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_language_glossary_language_section_org"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_language_glossary_language_section_org"
        ON "language_glossary_sections" ("languageId", "sectionCode",
          COALESCE("organizationId", '00000000-0000-0000-0000-000000000000'))`,
    );
  }
}
