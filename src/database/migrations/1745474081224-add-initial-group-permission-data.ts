import { MigrationInterface, QueryRunner } from 'typeorm';
import { Group } from '../../common/entities/group.entity';
import { PERMISSIONS } from '../../authorization/constants/auth.constants';
import { Permission } from '../../common/entities/permission.entity';
import { UserRole } from '../../common/constants/user.constants';

export class AddInitialGroupPermissionData1745474081224
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Get the COUNSELOR group ID
    const groups: Group[] = await queryRunner.query(
      `SELECT id,name FROM "groups" WHERE "name" IN ($1, $2)`,
      [UserRole.COUNSELOR, UserRole.SUPER_ADMIN],
    );

    if (groups && groups.length > 0) {
      const superAdminGroup = groups.find(
        (group) => group.name === UserRole.SUPER_ADMIN,
      );

      const counselorGroup = groups.find(
        (group) => group.name === UserRole.COUNSELOR,
      );

      // Get all permission IDs
      const allPermissions: Permission[] = await queryRunner.query(
        `SELECT id,name FROM "permissions"`,
      );

      const counselorGroupId = counselorGroup?.id;
      const superAdminGroupId = superAdminGroup?.id;

      const counselorPermissions = allPermissions.filter(
        (permission) => permission.name != PERMISSIONS.VIEW_NAVBAR_ANALYTICS,
      );

      // Insert group permissions for COUNSELOR group
      for (const permission of counselorPermissions) {
        await queryRunner.query(
          `INSERT INTO "group_permissions" ("groupId", "permissionId") VALUES ($1, $2)`,
          [counselorGroupId, permission.id],
        );
      }

      // Insert group permissions for SUPER_ADMIN group
      for (const permission of allPermissions) {
        await queryRunner.query(
          `INSERT INTO "group_permissions" ("groupId", "permissionId") VALUES ($1, $2)`,
          [superAdminGroupId, permission.id],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Get the COUNSELOR group ID
    const groups: Group[] = await queryRunner.query(
      `SELECT id,name FROM "groups" WHERE "name" IN ($1, $2)`,
      [UserRole.COUNSELOR, UserRole.SUPER_ADMIN],
    );

    if (groups && groups.length > 0) {
      const counselorGroup = groups.find(
        (group) => group.name === UserRole.COUNSELOR,
      );

      const superAdminGroup = groups.find(
        (group) => group.name === UserRole.SUPER_ADMIN,
      );

      const counselorGroupId = counselorGroup?.id;
      const superAdminGroupId = superAdminGroup?.id;

      // Delete all permissions for COUNSELOR group
      await queryRunner.query(
        `DELETE FROM "group_permissions" WHERE "groupId" = $1`,
        [counselorGroupId],
      );

      // Delete all permissions for SUPER_ADMIN group
      await queryRunner.query(
        `DELETE FROM "group_permissions" WHERE "groupId" = $1`,
        [superAdminGroupId],
      );
    }
  }
}
