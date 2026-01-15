import { MigrationInterface, QueryRunner } from 'typeorm';

enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
}

const PERMISSIONS = {
  VIEW_USERS: 'view:users',
  EDIT_USER_STATUS: 'edit:user:status',
  VIEW_USER_ROLES: 'view:user:roles',
};

export class AddUserManagementPermissions1760687530156 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure all user management permissions exist in the permissions table
    const userManagementPermissions = [
      PERMISSIONS.VIEW_USERS,
      PERMISSIONS.EDIT_USER_STATUS,
      PERMISSIONS.VIEW_USER_ROLES,
    ];

    for (const permissionName of userManagementPermissions) {
      // Check if permission already exists
      const existingPermission = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [permissionName],
      );

      // Only insert if it doesn't exist
      if (existingPermission.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [permissionName],
        );
      }
    }

    // 2. Get SUPER_ADMIN group ID only
    const roleGroups = [UserRole.SUPER_ADMIN]; // ✅ Only SUPER_ADMIN
    const groups = await queryRunner.query(
      `
            SELECT id, name FROM "groups" WHERE name IN (${roleGroups
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      roleGroups,
    );

    const groupMap = groups.reduce(
      (acc: Record<string, number>, group: { id: number; name: string }) => {
        acc[group.name] = group.id;
        return acc;
      },
      {},
    );

    // 3. Get all permission IDs for user management permissions
    const permissions = await queryRunner.query(
      `
            SELECT id, name FROM "permissions" WHERE name IN (${userManagementPermissions
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      userManagementPermissions,
    );

    const permissionMap = permissions.reduce(
      (
        acc: Record<string, number>,
        permission: { id: number; name: string },
      ) => {
        acc[permission.name] = permission.id;
        return acc;
      },
      {},
    );

    // 4. Define user management permission assignments - ONLY SUPER_ADMIN
    const userManagementPermissionMappings = [
      {
        role: UserRole.SUPER_ADMIN,
        permissions: [
          PERMISSIONS.VIEW_USERS,
          PERMISSIONS.EDIT_USER_STATUS,
          PERMISSIONS.VIEW_USER_ROLES,
        ],
      },
    ];

    // 5. Assign permissions to groups (only missing ones)
    for (const mapping of userManagementPermissionMappings) {
      const groupId = groupMap[mapping.role];
      if (!groupId) continue;

      for (const permissionName of mapping.permissions) {
        const permissionId = permissionMap[permissionName];
        if (!permissionId) continue;

        // Check if the group permission already exists
        const existingGroupPermission = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );

        // Only insert if it doesn't exist
        if (existingGroupPermission.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permissionId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove user management permissions that were added by this migration
    const userManagementPermissions = [
      PERMISSIONS.VIEW_USERS,
      PERMISSIONS.EDIT_USER_STATUS,
      PERMISSIONS.VIEW_USER_ROLES,
    ];

    await queryRunner.query(
      `DELETE FROM group_permissions WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN (${userManagementPermissions.map((_, index) => `$${index + 1}`).join(',')})
      )`,
      userManagementPermissions,
    );

    // Note: We don't remove the permissions themselves as they might be used by other groups
    // Only remove them if they're not used by any other groups
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN (${userManagementPermissions.map((_, index) => `$${index + 1}`).join(',')}) AND id NOT IN (
        SELECT DISTINCT "permissionId" FROM group_permissions
      )`,
      userManagementPermissions,
    );
  }
}
