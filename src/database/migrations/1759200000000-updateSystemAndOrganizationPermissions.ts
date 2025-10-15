import { MigrationInterface, QueryRunner } from 'typeorm';

enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
}

const PERMISSIONS = {
  START_CLOUD_TELEPHONY_CHAT: 'start:cloud-telephony-chat',
  SYSTEM_ACCESS: 'system:access',
  ORGANIZATION_ACCESS: 'organization:access',
  START_MICROPHONE_CHAT: 'start:microphone-chat',
  EDIT_SCENARIO_SESSION_FEEDBACK: 'edit:scenario-session:feedback',
  DELETE_SCENARIO_SESSION: 'delete:scenario-session',
};

const PERMISSIONS_TO_REASSIGN = {
  EDIT_REFERENCE_DOCUMENT: 'edit:reference-document',
};

const newPermissions = [
  PERMISSIONS.START_CLOUD_TELEPHONY_CHAT,
  PERMISSIONS.SYSTEM_ACCESS,
  PERMISSIONS.ORGANIZATION_ACCESS,
  PERMISSIONS.START_MICROPHONE_CHAT,
  PERMISSIONS.EDIT_SCENARIO_SESSION_FEEDBACK,
  PERMISSIONS.DELETE_SCENARIO_SESSION,
];

export class UpdateSystemAndOrganizationPermissions1759200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // create new permissions to be added

    for (const permissionName of newPermissions) {
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

    // Get all existing group IDs
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

    // Get all permission IDs
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

    // Assign only new permissions to groups based on role-specific arrays
    const newPermissionAssignments = [
      {
        role: UserRole.SUPER_ADMIN,
        permissions: [
          PERMISSIONS.SYSTEM_ACCESS,
          PERMISSIONS.DELETE_SCENARIO_SESSION,
        ],
      },
      {
        role: UserRole.ADMIN,
        permissions: [
          PERMISSIONS.ORGANIZATION_ACCESS,
          PERMISSIONS_TO_REASSIGN.EDIT_REFERENCE_DOCUMENT,
        ],
      },
      {
        role: UserRole.COUNSELOR,
        permissions: [
          PERMISSIONS.START_MICROPHONE_CHAT,
          PERMISSIONS.START_CLOUD_TELEPHONY_CHAT,
        ],
      },
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

    // Remove EDIT_REFERENCE_DOCUMENT permission from COUNSELOR if it exists
    const counselorGroupId = groupMap[UserRole.COUNSELOR];
    const editRefDocPermission = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name = $1`,
      [PERMISSIONS_TO_REASSIGN.EDIT_REFERENCE_DOCUMENT],
    );

    if (counselorGroupId && editRefDocPermission.length > 0) {
      const editRefDocPermissionId = editRefDocPermission[0].id;

      // Delete the permission from COUNSELOR group if it exists
      await queryRunner.query(
        `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
        [counselorGroupId, editRefDocPermissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore EDIT_REFERENCE_DOCUMENT permission to COUNSELOR
    const roleGroups = Object.values(UserRole);
    const groups = await queryRunner.query(
      `SELECT id, name FROM "groups" WHERE name IN (${roleGroups
        .map((_, index) => `$${index + 1}`)
        .join(',')})`,
      roleGroups,
    );

    const groupMap = groups.reduce(
      (acc: Record<string, number>, group: { id: number; name: string }) => {
        acc[group.name] = group.id;
        return acc;
      },
      {},
    );

    const counselorGroupId = groupMap[UserRole.COUNSELOR];
    const editRefDocPermission = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name = $1`,
      [PERMISSIONS_TO_REASSIGN.EDIT_REFERENCE_DOCUMENT],
    );

    if (counselorGroupId && editRefDocPermission.length > 0) {
      const editRefDocPermissionId = editRefDocPermission[0].id;

      // Check if it doesn't already exist before inserting
      const existingGroupPermission = await queryRunner.query(
        `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
        [counselorGroupId, editRefDocPermissionId],
      );

      if (existingGroupPermission.length === 0) {
        // Restore the permission to COUNSELOR group
        await queryRunner.query(
          `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
          [counselorGroupId, editRefDocPermissionId],
        );
      }
    }

    // Get IDs of permissions to be removed
    const permissionsToDelete = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name IN (${newPermissions
        .map((_, index) => `$${index + 1}`)
        .join(',')})`,
      newPermissions,
    );

    // Extract just the IDs
    const permissionIdsToDelete = permissionsToDelete.map(
      (p: { id: number }) => p.id,
    );

    if (permissionIdsToDelete.length > 0) {
      // Remove these permissions from group_permissions table
      await queryRunner.query(
        `DELETE FROM group_permissions WHERE "permissionId" IN (${permissionIdsToDelete
          .map((_: any, index: number) => `$${index + 1}`)
          .join(',')})`,
        permissionIdsToDelete,
      );

      // Remove these permissions from the permissions table
      await queryRunner.query(
        `DELETE FROM "permissions" WHERE id IN (${permissionIdsToDelete
          .map((_: any, index: number) => `$${index + 1}`)
          .join(',')})`,
        permissionIdsToDelete,
      );
    }
  }
}
