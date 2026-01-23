import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateUniqueIndexesInBadgeUsersAndTenants1769158790823 implements MigrationInterface {
  name = 'UpdateUniqueIndexesInBadgeUsersAndTenants1769158790823';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_users_user_id_badge_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_tenants_badge_id_tenant_id_idx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_user_user_id_badge_id_idx" ON "badge_users" ("userId", "badgeId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_tenant_badge_id_tenant_id_idx" ON "badge_tenants" ("badgeId", "tenantId") WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_tenant_badge_id_tenant_id_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_badge_user_user_id_badge_id_idx"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_tenants_badge_id_tenant_id_idx" ON "badge_tenants" ("badgeId", "tenantId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_badge_users_user_id_badge_id_idx" ON "badge_users" ("userId", "badgeId") `,
    );
  }
}
