import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Language variety profiles (variety-profiles phase 1):
 * - language_variety_profiles — how one deployment population speaks a
 *   language, inferred from learner-side transcripts (features jsonb,
 *   exemplars, deterministic description). Shared entities.
 * - variety_profile_attachments — many-to-one tenant→profile mapping, one
 *   active attachment per (tenant_id, language_id).
 *
 * v1 is inference + storage only; nothing reads these at runtime yet.
 */
export class CreateLanguageVarietyProfiles1916000000000 implements MigrationInterface {
  name = 'CreateLanguageVarietyProfiles1916000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "language_variety_profiles" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"languageId" integer NOT NULL, ` +
        `"name" character varying(255) NOT NULL, ` +
        `"description" text NOT NULL DEFAULT '', ` +
        `"status" character varying(20) NOT NULL DEFAULT 'inferred', ` +
        `"features" jsonb NOT NULL, ` +
        `"exemplars" jsonb NOT NULL DEFAULT '[]', ` +
        `"source" jsonb, ` +
        `"version" integer NOT NULL DEFAULT 1, ` +
        `"createdBy" character varying(255), ` +
        `"updatedBy" character varying(255), ` +
        `CONSTRAINT "PK_language_variety_profiles" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_variety_profiles_language_status" ` +
        `ON "language_variety_profiles" ("languageId", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "variety_profile_attachments" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"profileId" uuid NOT NULL, ` +
        `"tenantId" character varying(255) NOT NULL, ` +
        `"languageId" integer NOT NULL, ` +
        `"attachedBy" character varying(20) NOT NULL DEFAULT 'inferred', ` +
        `"similarity" double precision, ` +
        `CONSTRAINT "PK_variety_profile_attachments" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_variety_attachments_profile" ` +
        `ON "variety_profile_attachments" ("profileId")`,
    );
    // One active attachment per tenant per language — re-inference re-points
    // the row rather than stacking history.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_variety_attachment_tenant_language" ` +
        `ON "variety_profile_attachments" ("tenantId", "languageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "variety_profile_attachments"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "language_variety_profiles"`);
  }
}
