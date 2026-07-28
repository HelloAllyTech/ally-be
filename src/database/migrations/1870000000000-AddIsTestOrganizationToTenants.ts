import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsTestOrganizationToTenants1870000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Default false so every existing org keeps counting in analytics on
    // rollout; super-admins opt individual orgs out afterwards.
    await queryRunner.query(
      `ALTER TABLE "tenants"
       ADD COLUMN IF NOT EXISTS "isTestOrganization" boolean NOT NULL DEFAULT false`,
    );
    // Analytics filters every fact table against the test-org set on each
    // request, so keep the lookup of "which orgs are test" cheap.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "tenants_is_test_organization_idx"
       ON "tenants" ("isTestOrganization") WHERE "isTestOrganization" = true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "tenants_is_test_organization_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenants" DROP COLUMN IF EXISTS "isTestOrganization"`,
    );
  }
}
