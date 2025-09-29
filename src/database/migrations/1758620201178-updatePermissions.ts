import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PERMISSIONS,
  SUPER_ADMIN_PERMISSIONS,
  COUNSELOR_PERMISSIONS,
  ADMIN_PERMISSIONS,
  LEARNER_PERMISSIONS,
  CLIENT_PERMISSIONS,
} from '../../authorization/constants/permissions.constants';
import { UserRole } from '../../common/constants/user.constants';

export class UpdatePermissions1758620201178 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Insert all permissions from PERMISSIONS constant (only missing ones)
    const permissionValues = Object.values(PERMISSIONS);

    for (const permissionName of permissionValues) {
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
    const permissions = await queryRunner.query(
      `
            SELECT id, name FROM "permissions" WHERE name IN (${permissionValues
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      permissionValues,
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

    // 4. Assign permissions to groups based on role-specific arrays (only missing ones)
    const rolePermissionMappings = [
      { role: UserRole.SUPER_ADMIN, permissions: SUPER_ADMIN_PERMISSIONS },
      { role: UserRole.COUNSELOR, permissions: COUNSELOR_PERMISSIONS },
      { role: UserRole.ADMIN, permissions: ADMIN_PERMISSIONS },
      { role: UserRole.LEARNER, permissions: LEARNER_PERMISSIONS },
      { role: UserRole.CLIENT, permissions: CLIENT_PERMISSIONS },
    ];

    for (const mapping of rolePermissionMappings) {
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
    // Remove only the permissions that were added by this migration
    const permissionValues = Object.values(PERMISSIONS);
    await queryRunner.query(
      `DELETE FROM group_permissions WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN (${permissionValues.map((_, index) => `$${index + 1}`).join(',')})
      )`,
      permissionValues,
    );

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN (${permissionValues.map((_, index) => `$${index + 1}`).join(',')})`,
      permissionValues,
    );
  }
}
