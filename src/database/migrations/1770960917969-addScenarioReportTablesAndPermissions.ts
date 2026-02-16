import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioReportTablesAndPermissions1770960917969 implements MigrationInterface {
  name = 'AddScenarioReportTablesAndPermissions1770960917969';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_report_transcripts" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioReportId" uuid NOT NULL, "content" character varying NOT NULL, "endSeconds" double precision, "startSeconds" double precision, "sender" character varying NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_d713b15daa2ed8867fa7c1a961a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_report_transcripts_scenario_report_id" ON "scenario_report_transcripts" ("scenarioReportId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_reports" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioId" integer NOT NULL, "status" character varying NOT NULL DEFAULT 'STARTED', "score" integer, "config" jsonb NOT NULL, "metrics" jsonb, "deletedAt" TIMESTAMP, "createdBy" integer NOT NULL, "updatedBy" integer NOT NULL, "endedAt" TIMESTAMP, CONSTRAINT "PK_f991369eb9a61b0d878ae8361b9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_scenario_reports_scenario_id" ON "scenario_reports" ("scenarioId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(`
            INSERT INTO "permissions" ("name") VALUES
            ('view:scenario-reports'),
            ('edit:scenario-reports')
          `);

    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT g."id", p."id"
            FROM "groups" g
            CROSS JOIN "permissions" p
            WHERE g."name" = 'SUPER_ADMIN'
            AND p."name" IN ('view:scenario-reports', 'edit:scenario-reports')
          `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DELETE FROM "group_permissions"
            WHERE "permissionId" IN (
              SELECT "id" FROM "permissions"
              WHERE "name" IN ('view:scenario-reports', 'edit:scenario-reports')
            )
          `);

    await queryRunner.query(`
            DELETE FROM "permissions"
            WHERE "name" IN ('view:scenario-reports', 'edit:scenario-reports')
          `);

    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_reports_scenario_id"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_reports"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_scenario_report_transcripts_scenario_report_id"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_report_transcripts"`);
  }
}
