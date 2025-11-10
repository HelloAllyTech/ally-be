import { MigrationInterface, QueryRunner } from 'typeorm';

export class SettingsPermissionsUpdate1761920939995
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      'edit:settings:summary-fields',
      'edit:settings:chat-types',
      'edit:analytics:dashboard',
    ];

    const groupNames = ['SUPER_ADMIN', 'ADMIN', 'COUNSELOR'];

    // Get permission IDs
    const permissionIds: Record<string, string> = {};
    for (const permissionName of permissions) {
      const result = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [permissionName],
      );
      if (result.length === 0) {
        throw new Error(
          `Permission ${permissionName} not found in permissions table`,
        );
      }
      permissionIds[permissionName] = result[0].id;
    }

    // Get group IDs
    const groupIds: Record<string, string | undefined> = {};
    for (const groupName of groupNames) {
      const result = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1`,
        [groupName],
      );
      groupIds[groupName] = result[0]?.id;
    }

    // Remove all permissions from ADMIN
    const adminGroupId = groupIds['ADMIN'];
    if (adminGroupId) {
      for (const permissionName of permissions) {
        await queryRunner.query(
          `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [adminGroupId, permissionIds[permissionName]],
        );
      }
    }

    // Remove edit:settings:summary-fields from COUNSELOR
    const counselorGroupId = groupIds['COUNSELOR'];
    if (counselorGroupId) {
      await queryRunner.query(
        `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
        [counselorGroupId, permissionIds['edit:settings:summary-fields']],
      );
    }

    // Add all permissions to SUPER_ADMIN (if not exists)
    const superAdminGroupId = groupIds['SUPER_ADMIN'];
    if (superAdminGroupId) {
      for (const permissionName of permissions) {
        const existing = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [superAdminGroupId, permissionIds[permissionName]],
        );
        if (existing.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [superAdminGroupId, permissionIds[permissionName]],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      'edit:settings:summary-fields',
      'edit:settings:chat-types',
      'edit:analytics:dashboard',
    ];

    const groupNames = ['SUPER_ADMIN', 'ADMIN', 'COUNSELOR'];

    // Get permission IDs
    const permissionIds: Record<string, string> = {};
    for (const permissionName of permissions) {
      const result = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [permissionName],
      );
      if (result.length === 0) {
        return;
      }
      permissionIds[permissionName] = result[0].id;
    }

    // Get group IDs
    const groupIds: Record<string, string | undefined> = {};
    for (const groupName of groupNames) {
      const result = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1`,
        [groupName],
      );
      groupIds[groupName] = result[0]?.id;
    }

    // Remove all permissions from SUPER_ADMIN (revert)
    const superAdminGroupId = groupIds['SUPER_ADMIN'];
    if (superAdminGroupId) {
      for (const permissionName of permissions) {
        await queryRunner.query(
          `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [superAdminGroupId, permissionIds[permissionName]],
        );
      }
    }

    // Add all permissions back to ADMIN (revert)
    const adminGroupId = groupIds['ADMIN'];
    if (adminGroupId) {
      for (const permissionName of permissions) {
        const existing = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [adminGroupId, permissionIds[permissionName]],
        );
        if (existing.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [adminGroupId, permissionIds[permissionName]],
          );
        }
      }
    }

    // Add edit:settings:summary-fields back to COUNSELOR (revert)
    const counselorGroupId = groupIds['COUNSELOR'];
    if (counselorGroupId) {
      const existing = await queryRunner.query(
        `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
        [counselorGroupId, permissionIds['edit:settings:summary-fields']],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
          [counselorGroupId, permissionIds['edit:settings:summary-fields']],
        );
      }
    }
  }
}
