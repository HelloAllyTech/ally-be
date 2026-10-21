import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two tables that make Builder's knowledge of the platform checkable.
 *
 * ## builder_repo_catalogs — one row per repo
 *
 * What `scripts/builder/extract-catalog.mjs` reads off a repo's tree: modules, tables, routes,
 * screens, components, scheduled jobs, endpoints and docs, as a JSON array. Written by the
 * context-refresh workflow beside the knowledge pack and replaced whole. Separate from
 * `builder_repo_maps` because a pack is model prose that can fail to a sentence while a catalog
 * cannot, and neither should be able to overwrite the other.
 *
 * ## builder_evidence — append-only, per session
 *
 * Every research lookup a Builder session makes, succeeded or failed, with a short excerpt. The
 * readiness rubric and the PRD reviewer check the PRD's claims against it; the technical design
 * inherits it. Deleted with the session.
 *
 * The CHECK bounds the excerpt so an accidental whole-file write cannot grow the table without
 * limit; the service already trims to well under it.
 */
export class CreateBuilderCatalogAndEvidence1979100000000 implements MigrationInterface {
  name = 'CreateBuilderCatalogAndEvidence1979100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_repo_catalogs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "repo" character varying(80) NOT NULL,
        "commitSha" character varying(60),
        "entries" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "stats" jsonb,
        "generatedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_repo_catalogs_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_repo_catalogs_entries_array" CHECK (jsonb_typeof("entries") = 'array')
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_builder_repo_catalogs_repo" ON "builder_repo_catalogs" ("repo")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_evidence" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sessionId" uuid NOT NULL,
        "tool" character varying(60) NOT NULL,
        "source" character varying(500) NOT NULL,
        "ok" boolean NOT NULL,
        "excerpt" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_evidence_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_builder_evidence_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_builder_evidence_excerpt_length" CHECK ("excerpt" IS NULL OR char_length("excerpt") <= 4000)
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_evidence_session" ON "builder_evidence" ("sessionId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_evidence"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_repo_catalogs"`);
  }
}
