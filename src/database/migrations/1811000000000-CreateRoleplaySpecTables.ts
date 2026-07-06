import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roleplay Studio v2 authoring tables:
 *  - roleplay_specs           — the authoring root; `draftSpec` is the mutable
 *                               working document, `scenarioId` the thin
 *                               scenarios shell created at spec creation.
 *  - roleplay_spec_versions   — append-only immutable snapshots of the draft;
 *                               one is PUBLISHED at a time per spec.
 *  - roleplay_spec_tenants    — spec→tenant visibility, copied into
 *                               scenario_tenants on publish.
 *
 * Loose-FK convention: bare columns + partial indexes, no DB constraints.
 */
export class CreateRoleplaySpecTables1811000000000 implements MigrationInterface {
  name = 'CreateRoleplaySpecTables1811000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roleplay_specs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'DRAFT', "competencyId" uuid, "scenarioId" integer NOT NULL, "draftSpec" jsonb NOT NULL DEFAULT '{}'::jsonb, "publishedVersionId" uuid, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_specs_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_specs_scenario_id" ON "roleplay_specs" ("scenarioId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_specs_created_by" ON "roleplay_specs" ("createdBy") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "roleplay_spec_versions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "versionNumber" integer NOT NULL, "spec" jsonb NOT NULL DEFAULT '{}'::jsonb, "status" character varying NOT NULL DEFAULT 'DRAFT', "source" character varying NOT NULL DEFAULT 'snapshot', "patchId" uuid, "publishedAt" TIMESTAMP, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_spec_versions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roleplay_spec_versions_spec_id" ON "roleplay_spec_versions" ("specId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_roleplay_spec_versions_spec_id_version" ON "roleplay_spec_versions" ("specId", "versionNumber") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "roleplay_spec_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "specId" uuid NOT NULL, "tenantId" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_roleplay_spec_tenants_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "idx_roleplay_spec_tenants_spec_tenant" ON "roleplay_spec_tenants" ("specId", "tenantId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_spec_tenants_spec_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_spec_tenants"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_spec_versions_spec_id_version"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_spec_versions_spec_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_spec_versions"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_specs_created_by"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_roleplay_specs_scenario_id"`,
    );
    await queryRunner.query(`DROP TABLE "roleplay_specs"`);
  }
}
