import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewBadgesSettingPermission1773720805810 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES
        ('view:admin:badges-for-setting')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:admin:badges-for-setting')
      WHERE g."name" = '${UserRole.MULTI_TENANT_ADMIN}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN ('view:admin:badges-for-setting')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('view:admin:badges-for-setting')
    `);
  }
}
