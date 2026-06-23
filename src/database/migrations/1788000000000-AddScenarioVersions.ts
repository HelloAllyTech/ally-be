import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioVersions1788000000000 implements MigrationInterface {
  name = 'AddScenarioVersions1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Versions table — one immutable-once-published snapshot per save.
    await queryRunner.query(
      `CREATE TABLE "scenario_versions" (` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"scenarioId" integer NOT NULL, ` +
        `"versionNumber" integer NOT NULL, ` +
        `"name" character varying, ` +
        `"config" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"status" character varying NOT NULL DEFAULT 'DRAFT', ` +
        `"parentVersionId" uuid, ` +
        `"createdBy" integer, ` +
        `"updatedBy" integer, ` +
        `"deletedAt" TIMESTAMP, ` +
        `CONSTRAINT "PK_scenario_versions" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_versions_scenario_id" ON "scenario_versions" ("scenarioId") WHERE "deletedAt" IS NULL`,
    );
    // Version numbers are unique per scenario among live (non-deleted) rows.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_scenario_versions_scenario_version_number" ON "scenario_versions" ("scenarioId", "versionNumber") WHERE "deletedAt" IS NULL`,
    );

    // 2. Live pointer + run/report version tags.
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD COLUMN "publishedVersionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" ADD COLUMN "scenarioVersionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" ADD COLUMN "scenarioVersionId" uuid`,
    );

    // 3. Backfill a baseline v1 for every existing scenario. Config is the
    // flattened studio-form shape (metadata merged with the row columns). Note:
    // related tables (trigger warnings, termination events, behavior
    // instructions) are NOT captured in this baseline snapshot — they are only
    // snapshotted from this point forward when the form submits a full config.
    await queryRunner.query(
      `INSERT INTO "scenario_versions" ` +
        `("scenarioId", "versionNumber", "name", "config", "status", "createdBy", "updatedBy") ` +
        `SELECT s."id", 1, NULL, ` +
        `COALESCE(s."metadata", '{}'::jsonb) || jsonb_build_object(` +
        `'title', s."title", 'description', s."description", 'prompt', s."prompt", ` +
        `'coverImageUrl', s."coverImageUrl", 'coverVideoUrl', s."coverVideoUrl", ` +
        `'isPublic', s."isPublic", 'isGlobal', s."isGlobal", ` +
        `'difficultyLevel', s."difficultyLevel", 'competencyId', s."competencyId", ` +
        `'status', 'DRAFT'), ` +
        `CASE WHEN s."status" = 'ACTIVE' THEN 'PUBLISHED' ELSE 'DRAFT' END, ` +
        `s."createdBy", COALESCE(s."updatedBy", s."createdBy") ` +
        `FROM "scenarios" s ` +
        `WHERE s."deletedAt" IS NULL`,
    );

    // Point live (ACTIVE) scenarios at their newly-created published v1.
    await queryRunner.query(
      `UPDATE "scenarios" s SET "publishedVersionId" = v."id" ` +
        `FROM "scenario_versions" v ` +
        `WHERE v."scenarioId" = s."id" AND v."status" = 'PUBLISHED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_reports" DROP COLUMN "scenarioVersionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_sessions" DROP COLUMN "scenarioVersionId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" DROP COLUMN "publishedVersionId"`,
    );
    await queryRunner.query(
      `DROP INDEX "UQ_scenario_versions_scenario_version_number"`,
    );
    await queryRunner.query(`DROP INDEX "idx_scenario_versions_scenario_id"`);
    await queryRunner.query(`DROP TABLE "scenario_versions"`);
  }
}
