import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Three columns on `roadmap_opportunities` for the consumer-facing
 * POST /product-roadmap/bug-reports endpoint (see RoadmapOpportunityController /
 * RoadmapOpportunityService.createBugReport), which reuses the existing staff
 * `create()` pipeline rather than a separate table:
 *
 *  - `source` — 'staff' (every pre-existing row and the admin `/opportunities` path) vs
 *    'consumer' (the new path). Admin-side filtering only; CHECK-constrained like `type`
 *    and `stage` (ally-be convention: character varying + CHECK, not a pg enum).
 *  - `tenant_id` — informational only, NOT a tenant-scoping column: `roadmap_opportunities`
 *    stays a global, non-tenant-isolated table (BaseWithoutTenantEntity), same as every
 *    other read/write path here. Named and typed to match the platform's `tenant_id`
 *    convention (character varying — see `scenario_sessions.tenant_id`, `BaseEntity`), not
 *    a uuid FK.
 *  - `reporterContext` — jsonb, auto-captured client context (screen, app version, device/
 *    OS, client timestamp) sent by the consumer app. Admin-visible only, alongside
 *    `description`; never runs through crisis-content detection.
 *
 * All three are nullable/defaulted so every existing row needs no backfill.
 */
export class AddConsumerBugReportFieldsToRoadmapOpportunities1909000000000 implements MigrationInterface {
  name = 'AddConsumerBugReportFieldsToRoadmapOpportunities1909000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD "source" character varying NOT NULL DEFAULT 'staff'`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_source" CHECK ("source" IN ('staff', 'consumer'))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_roadmap_opps_source" ON "roadmap_opportunities" ("source") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD "tenant_id" character varying`,
    );

    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD "reporterContext" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "reporterContext"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "tenant_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_roadmap_opps_source"`);
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opps_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "source"`,
    );
  }
}
