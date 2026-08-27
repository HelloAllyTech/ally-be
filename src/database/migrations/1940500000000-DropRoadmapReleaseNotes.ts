import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `roadmap_release_notes`. The roadmap's compose-with-an-LLM release-notes flow is
 * deprecated, superseded by the automated changelog: every merge across the Ally repos already
 * produces a customer-facing line via `ally-changelog`, which mirrors it to ally-be's public
 * changelog feed. Two ways to write the same artefact, one of them hand-run and unused.
 *
 * SAFETY: the table was empty on every database checked (0 rows locally, and the pre-migration
 * recon of the standalone app it came from found 0 — the feature shipped there on 2026-07-01 and
 * was never used). It is nonetheless a DROP, and production was not inspected from the machine
 * that wrote this. Run the count below before deploying:
 *
 *     SELECT count(*) FROM roadmap_release_notes;
 *
 * `down()` restores the SCHEMA — the table, its checks and its index, byte-identical to what
 * migration 1871000000000 created — but NOT the rows. There is no undo for the data; that is
 * what the count above is for.
 */
export class DropRoadmapReleaseNotes1940500000000 implements MigrationInterface {
  name = 'DropRoadmapReleaseNotes1940500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_release_notes_created_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_release_notes"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roadmap_release_notes" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" text, "content" text NOT NULL, "opportunityIds" uuid array NOT NULL DEFAULT '{}', "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roadmap_release_notes_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_roadmap_release_notes_content" CHECK (char_length(trim("content")) > 0 AND char_length("content") <= 20000), CONSTRAINT "CHK_roadmap_release_notes_title" CHECK ("title" IS NULL OR char_length("title") <= 200))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_release_notes_created_at" ON "roadmap_release_notes" ("createdAt" DESC) WHERE "deletedAt" IS NULL`,
    );
  }
}
