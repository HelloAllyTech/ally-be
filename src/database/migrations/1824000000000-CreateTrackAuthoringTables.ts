import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Track 2.0 authoring tables (multi-component learning tracks, built alongside
 * the legacy scenario_paths system):
 *  - tracks          — course root: title/cover/status/isGlobal/translations,
 *                      denormalized totalItems, SEQUENTIAL progression mode.
 *  - track_sections  — ordered named units inside a track.
 *  - track_items     — ordered components inside a section. Hybrid
 *                      polymorphism: scenarioId (ROLEPLAY) / caseId (CASE)
 *                      reference columns + `content` JSONB for inline-authored
 *                      QUIZ/ARTICLE/VIDEO/JOURNAL, plus a per-item
 *                      `completionCriteria` JSONB.
 *  - track_tenants   — track→tenant visibility (mirrors scenario_path_tenants).
 *
 * Loose-FK convention: bare columns + partial indexes, no DB constraints.
 */
export class CreateTrackAuthoringTables1824000000000 implements MigrationInterface {
  name = 'CreateTrackAuthoringTables1824000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tracks" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying, "description" text, "coverImageUrl" character varying, "status" character varying NOT NULL DEFAULT 'DRAFT', "isGlobal" boolean NOT NULL DEFAULT false, "progressionMode" character varying NOT NULL DEFAULT 'SEQUENTIAL', "totalItems" integer NOT NULL DEFAULT 0, "estimatedDurationMinutes" integer, "createdBy" integer, "updatedBy" integer, "translations" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_tracks_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tracks_status" ON "tracks" ("status") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tracks_is_global" ON "tracks" ("isGlobal") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_sections" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackId" uuid NOT NULL, "title" character varying NOT NULL, "description" text, "order" integer NOT NULL, "unlockRule" character varying NOT NULL DEFAULT 'SEQUENTIAL', "translations" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_sections_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_sections_track_id" ON "track_sections" ("trackId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_track_sections_track_id_order" ON "track_sections" ("trackId", "order") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_items" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackId" uuid NOT NULL, "trackSectionId" uuid NOT NULL, "type" character varying NOT NULL, "order" integer NOT NULL, "title" character varying NOT NULL, "description" text, "scenarioId" integer, "caseId" uuid, "content" jsonb, "completionCriteria" jsonb, "translations" jsonb, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_items_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_items_track_id" ON "track_items" ("trackId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_track_items_track_section_id" ON "track_items" ("trackSectionId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_track_items_section_id_order" ON "track_items" ("trackSectionId", "order") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "track_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "trackId" uuid NOT NULL, "tenantId" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_track_tenants_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_track_tenants_track_tenant" ON "track_tenants" ("trackId", "tenantId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_tenants_track_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "track_tenants"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_items_section_id_order"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_items_track_section_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_track_items_track_id"`);
    await queryRunner.query(`DROP TABLE "track_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_sections_track_id_order"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_track_sections_track_id"`,
    );
    await queryRunner.query(`DROP TABLE "track_sections"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tracks_is_global"`);
    await queryRunner.query(`DROP INDEX "public"."idx_tracks_status"`);
    await queryRunner.query(`DROP TABLE "tracks"`);
  }
}
