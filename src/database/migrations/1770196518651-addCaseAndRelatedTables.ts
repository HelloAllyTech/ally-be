import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCaseAndRelatedTables1770196518651 implements MigrationInterface {
  name = 'AddCaseAndRelatedTables1770196518651';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cases" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying, "description" character varying, "coverImageUrl" character varying, "status" character varying NOT NULL DEFAULT 'DRAFT', "isGlobal" boolean NOT NULL DEFAULT false, "totalScenarios" integer NOT NULL DEFAULT '0', "createdBy" integer, "updatedBy" integer, "deletedAt" TIMESTAMP, CONSTRAINT "PK_264acb3048c240fb89aa34626db" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "case_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caseId" uuid NOT NULL, "tenantId" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_0f898a4887615e75af4157fd856" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "case_sessions" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caseId" uuid NOT NULL, "userId" integer NOT NULL, "startedAt" TIMESTAMP, "completedAt" TIMESTAMP, "completedScenarios" integer NOT NULL DEFAULT '0', "deletedAt" TIMESTAMP, CONSTRAINT "PK_87f3c11226cd91db154e0c7833a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "case_session_items" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caseSessionId" uuid NOT NULL, "userId" integer NOT NULL, "caseItemId" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'UNLOCKED', "deletedAt" TIMESTAMP, CONSTRAINT "PK_30fd1170e5afcb1af6422ff206b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "case_items" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "caseId" uuid NOT NULL, "scenarioId" integer NOT NULL, "order" integer NOT NULL, "messageTitle" character varying, "messageContent" character varying, "minimumScore" integer, "deletedAt" TIMESTAMP, CONSTRAINT "PK_d96bc48c14fc5c8b362774e23f1" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "case_items"`);
    await queryRunner.query(`DROP TABLE "case_session_items"`);
    await queryRunner.query(`DROP TABLE "case_sessions"`);
    await queryRunner.query(`DROP TABLE "case_tenants"`);
    await queryRunner.query(`DROP TABLE "cases"`);
  }
}
