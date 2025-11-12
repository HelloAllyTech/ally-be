import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioPathsTable1762948303773 implements MigrationInterface {
  name = 'AddScenarioPathsTable1762948303773';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_paths" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying, "description" character varying, "coverImageUrl" character varying, "status" character varying NOT NULL DEFAULT 'DRAFT', "isGlobal" boolean NOT NULL DEFAULT false, "totalScenarios" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_2ff0e3ed24e2bae6f107ce4aa8b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_path_session_items" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioPathSessionId" character varying NOT NULL, "userId" integer NOT NULL, "scenarioPathId" character varying NOT NULL, "status" character varying NOT NULL DEFAULT 'IN_PROGRESS', "duration" double precision, CONSTRAINT "PK_a81cafd4bfff099319500334ff7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_path_items" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioPathId" character varying NOT NULL, "scenarioId" integer NOT NULL, "order" integer NOT NULL, "message" character varying, "minimumScore" integer, CONSTRAINT "PK_b433a70a0be16850421b020c4d3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_path_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioPathId" character varying NOT NULL, "tenantId" character varying NOT NULL, CONSTRAINT "PK_c275194faf62575b8bba37c8faa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "scenario_path_sessions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "scenarioPathId" character varying NOT NULL, "userId" integer NOT NULL, "startedAt" TIMESTAMP, "completedAt" TIMESTAMP, "completedScenarios" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_e30f6dfaf2c221279ab886f13ab" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "scenario_path_sessions"`);
    await queryRunner.query(`DROP TABLE "scenario_path_tenants"`);
    await queryRunner.query(`DROP TABLE "scenario_path_items"`);
    await queryRunner.query(`DROP TABLE "scenario_path_session_items"`);
    await queryRunner.query(`DROP TABLE "scenario_paths"`);
  }
}
