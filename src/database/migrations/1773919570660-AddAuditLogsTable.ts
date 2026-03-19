import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogsTable1773919570660 implements MigrationInterface {
  name = 'AddAuditLogsTable1773919570660';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "eventType" character varying NOT NULL, "userId" integer, "tenantId" character varying, "details" jsonb, "ipAddress" character varying, "userAgent" character varying, "loggedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
