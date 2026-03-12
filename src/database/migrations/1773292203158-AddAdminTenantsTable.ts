import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminTenantsTable1773292203158 implements MigrationInterface {
  name = 'AddAdminTenantsTable1773292203158';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_tenants" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "tenantId" uuid NOT NULL, "deletedAt" TIMESTAMP, CONSTRAINT "PK_5100b8ff753e1e7edc0a55d3e3c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_admin_tenants_user_id_tenant_id_idx" ON "admin_tenants" ("userId", "tenantId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_admin_tenants_user_id_tenant_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE "admin_tenants"`);
  }
}
