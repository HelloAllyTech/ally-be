import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  COUNSELOR_PERMISSIONS,
  ADMIN_PERMISSIONS,
  LEARNER_PERMISSIONS,
  CLIENT_PERMISSIONS,
} from '../../authorization/constants/permissions.constants';

enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
}
export class UpdateSystemAndOrganizationPermissions1759200000000
  implements MigrationInterface
{
  // 1. Insert new permissions
  newPermissions = [
    PERMISSIONS.START_CLOUD_TELEPHONY_CHAT,
    PERMISSIONS.SYSTEM_ACCESS,
    PERMISSIONS.ORGANIZATION_ACCESS,
    PERMISSIONS.ACCESS_OTHERS_CHATS,
    PERMISSIONS.ACCESS_OTHERS_CALL_INFO,
    PERMISSIONS.START_MICROPHONE_CHAT,
    PERMISSIONS.JOIN_CALL,
  ];
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permissionName of this.newPermissions) {
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

    // 2. Get all existing group IDs
    const roleGroups = Object.values(UserRole);
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

    // 3. Get all permission IDs
    const allPermissions = Object.values(PERMISSIONS);
    const permissions = await queryRunner.query(
      `
            SELECT id, name FROM "permissions" WHERE name IN (${allPermissions
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      allPermissions,
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

    // 4. Assign only new permissions to groups based on role-specific arrays
    const newPermissionAssignments = [
      {
        role: UserRole.SUPER_ADMIN,
        permissions: [
          PERMISSIONS.SYSTEM_ACCESS,
          PERMISSIONS.ACCESS_OTHERS_CHATS,
          PERMISSIONS.START_CLOUD_TELEPHONY_CHAT,
          PERMISSIONS.START_MICROPHONE_CHAT,
        ],
      },
      {
        role: UserRole.ADMIN,
        permissions: [
          PERMISSIONS.ORGANIZATION_ACCESS,
          PERMISSIONS.ACCESS_OTHERS_CHATS,
          PERMISSIONS.ACCESS_OTHERS_CALL_INFO,
        ],
      },
      {
        role: UserRole.CLIENT,
        permissions: [PERMISSIONS.JOIN_CALL],
      },
      { role: UserRole.CLIENT, permissions: [PERMISSIONS.JOIN_CALL] },
    ];

    for (const mapping of newPermissionAssignments) {
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
    // Remove the new permissions from groups
    const permissions = await queryRunner.query(
      `
            SELECT id, name FROM "permissions" WHERE name IN (${this.newPermissions
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      this.newPermissions,
    );

    for (const permission of permissions) {
      await queryRunner.query(
        `DELETE FROM group_permissions WHERE "permissionId" = $1`,
        [permission.id],
      );
    }

    // Remove the new permissions from permissions table
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN (${this.newPermissions.map((_, index) => `$${index + 1}`).join(',')})`,
      this.newPermissions,
    );
  }
}
