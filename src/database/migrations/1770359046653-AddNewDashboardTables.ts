import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNewDashboardTables1770359046653 implements MigrationInterface {
  name = 'AddNewDashboardTables1770359046653';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dashboards" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "externalId" character varying NOT NULL, "name" character varying NOT NULL, "description" text, "data" jsonb, "analyticsType" character varying NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "UQ_d807229aaad5e283cfb5ba635dc" UNIQUE ("externalId"), CONSTRAINT "PK_1b4b4bc346118e0d335f16c5344" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "dashboard_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dashboardId" uuid NOT NULL, "tenantId" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_3e472f3d989393aa9bd7112ac5c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dashboard_tenants_dashboard_id_tenant_id_idx" ON "dashboard_tenants" ("dashboardId", "tenantId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "dashboard_groups" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dashboardId" uuid NOT NULL, "groupId" integer NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_a0a9c7b16914e97100274d2078f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_dashboard_groups_dashboard_id_group_id_idx" ON "dashboard_groups" ("dashboardId", "groupId") WHERE "deletedAt" IS NULL`,
    );

    // Data migration
    // 1) Insert dashboards (Table B)
    await queryRunner.query(`
    INSERT INTO "dashboards" (
      "externalId",
      "name",
      "description",
      "data",
      "analyticsType"
    )
    SELECT DISTINCT
      d."externalId",
      CASE g."name"
        WHEN 'ADMIN' THEN 'Organizational Admin Dashboard'
        WHEN 'COUNSELOR' THEN 'Counselor analytics'
        WHEN 'LEARNER' THEN 'Learner analytics'
      END AS "name",
      CASE g."name"
        WHEN 'ADMIN' THEN 'Dashboard for organizational admin'
        WHEN 'COUNSELOR' THEN 'Dashboard for counselor'
        WHEN 'LEARNER' THEN 'Dashboard for learner'
      END AS "description",
      d."data",
      CASE g."name"
        WHEN 'ADMIN' THEN 'ORG_ANALYTICS'
        WHEN 'COUNSELOR' THEN 'CALL_LOG_ANALYTICS'
        WHEN 'LEARNER' THEN 'SIMULATION_ANALYTICS'
      END AS "analyticsType"
    FROM "dashboard" d
    JOIN "groups" g ON d."groupId"::int = g."id"
    WHERE d."externalId" IS NOT NULL
      AND g."name" IN ('ADMIN', 'COUNSELOR', 'LEARNER')
    ON CONFLICT ("externalId") DO NOTHING;
  `);

    // 2) Insert dashboard_groups (Table C)
    await queryRunner.query(`
    INSERT INTO "dashboard_groups" (
      "dashboardId",
      "groupId"
    )
    SELECT DISTINCT
      db."id" AS "dashboardId",
      d."groupId"::int AS "groupId"
    FROM "dashboard" d
    JOIN "dashboards" db
      ON db."externalId" = d."externalId"
    WHERE d."externalId" IS NOT NULL
    ON CONFLICT DO NOTHING;
  `);

    // 3) Insert dashboard_tenants (Table D)
    await queryRunner.query(`
    INSERT INTO "dashboard_tenants" (
      "dashboardId",
      "tenantId"
    )
    SELECT DISTINCT
      db."id" AS "dashboardId",
      d."tenant_id"::uuid AS "tenantId"
    FROM "dashboard" d
    JOIN "dashboards" db
      ON db."externalId" = d."externalId"
    WHERE d."externalId" IS NOT NULL
      AND d."tenant_id" IS NOT NULL
    ON CONFLICT DO NOTHING;
  `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "dashboard_tenants"`);
    await queryRunner.query(`DELETE FROM "dashboard_groups"`);
    await queryRunner.query(`DELETE FROM "dashboards"`);

    await queryRunner.query(
      `DROP INDEX "public"."uq_dashboard_groups_dashboard_id_group_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "dashboard_groups"`);
    await queryRunner.query(
      `DROP INDEX "public"."uq_dashboard_tenants_dashboard_id_tenant_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "dashboard_tenants"`);
    await queryRunner.query(`DROP TABLE "dashboards"`);
  }
}
