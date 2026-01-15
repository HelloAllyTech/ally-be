import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenarioTenantsTable1763526592927 implements MigrationInterface {
  name = 'CreateScenarioTenantsTable1763526592927';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioId" integer NOT NULL, "tenantId" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_db7910693da5c900b08974f0cee" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_f0ebdd9c2450963dbaf928b7bd" ON "scenario_tenants" ("scenarioId", "tenantId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "isGlobal" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "isGlobal"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f0ebdd9c2450963dbaf928b7bd"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_tenants"`);
  }
}
