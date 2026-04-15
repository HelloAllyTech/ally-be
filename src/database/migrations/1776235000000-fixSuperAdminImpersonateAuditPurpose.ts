import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSuperAdminImpersonateAuditPurpose1776235000000 implements MigrationInterface {
  name = 'FixSuperAdminImpersonateAuditPurpose1776235000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "audit_logs"
      SET "details" = jsonb_set(
        "details",
        '{purpose}',
        '"Super admin impersonated a user"',
        true
      )
      WHERE "eventType" = 'SUPER_ADMIN_IMPERSONATE'
        AND "details" IS NOT NULL
        AND "details"->>'purpose' = 'Audio transcript request sent to AI service'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "audit_logs"
      SET "details" = jsonb_set(
        "details",
        '{purpose}',
        '"Audio transcript request sent to AI service"',
        true
      )
      WHERE "eventType" = 'SUPER_ADMIN_IMPERSONATE'
        AND "details" IS NOT NULL
        AND "details"->>'purpose' = 'Super admin impersonated a user'
    `);
  }
}
