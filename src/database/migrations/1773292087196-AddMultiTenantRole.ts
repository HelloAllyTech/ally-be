import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultiTenantRole1773292087196 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "groups" ("name")
      SELECT '${UserRole.MULTI_TENANT_ADMIN}'
      WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = '${UserRole.MULTI_TENANT_ADMIN}')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "groups" WHERE "name" = '${UserRole.MULTI_TENANT_ADMIN}'
    `);
  }
}
