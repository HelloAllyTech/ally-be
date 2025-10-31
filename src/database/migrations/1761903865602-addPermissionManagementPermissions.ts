import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionManagementPermissions1761903865602
  implements MigrationInterface
{
  name = 'AddPermissionManagementPermissions1761903865602';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
         VALUES
           ('delete:permission'),
           ('edit:permission'),
           ('edit:groups:permission'),
           ('delete:groups:permission')`,
    );

    // Grant permissions to SUPER_ADMIN
    await queryRunner.query(
      `WITH "newPermissionIds" AS (
           SELECT 
             id AS "permissionIds"
           FROM "permissions"
           WHERE name IN ('delete:permission', 'edit:permission', 'edit:groups:permission', 'delete:groups:permission')
         )
         INSERT INTO "group_permissions" ("groupId", "permissionId")
         SELECT id, "newPermissionIds"."permissionIds"
         FROM "groups", "newPermissionIds"
         WHERE name = '${UserRole.SUPER_ADMIN}'
           AND "newPermissionIds"."permissionIds" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permissions from SUPER_ADMIN
    await queryRunner.query(
      `DELETE FROM "group_permissions"
         WHERE "permissionId" IN (
           SELECT id
           FROM "permissions"
           WHERE name IN ('delete:permission', 'edit:permission', 'edit:groups:permission', 'delete:groups:permission')
         )
         AND "groupId" = (
           SELECT id
           FROM "groups"
           WHERE name = '${UserRole.SUPER_ADMIN}'
         )`,
    );

    // Delete permissions
    await queryRunner.query(
      `DELETE FROM "permissions"
         WHERE name IN ('delete:permission', 'edit:permission', 'edit:groups:permission', 'delete:groups:permission')`,
    );
  }
}
