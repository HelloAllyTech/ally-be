import { MigrationInterface, QueryRunner } from 'typeorm';

enum UserRole {
  CLIENT = 'CLIENT',
  COUNSELOR = 'COUNSELOR',
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  LEARNER = 'LEARNER',
}

const PERMISSIONS = {
  VIEW_ANALYTICS_DASHBOARD: 'view:analytics:dashboard',
  VIEW_ANALYTICS_DASHBOARD_URL: 'view:analytics:dashboard-url',
};

export class UpdateAnalyticsPermissions1760000583448
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure all analytics permissions exist in the permissions table
    const analyticsPermissions = [
      PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
      PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
    ];

    for (const permissionName of analyticsPermissions) {
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

    // 2. Get all existing group IDs for the roles that should have analytics access
    const roleGroups = [UserRole.ADMIN, UserRole.COUNSELOR, UserRole.LEARNER];
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

    // 3. Get all permission IDs for analytics permissions
    const permissions = await queryRunner.query(
      `
            SELECT id, name FROM "permissions" WHERE name IN (${analyticsPermissions
              .map((_, index) => `$${index + 1}`)
              .join(',')})
        `,
      analyticsPermissions,
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

    // 4. Define analytics permission assignments by role
    const analyticsPermissionMappings = [
      // ADMIN gets analytics permissions except counselor-specific dashboard URL
      {
        role: UserRole.ADMIN,
        permissions: [
          PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
          PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
        ],
      },
      // COUNSELOR gets basic analytics and counselor dashboard URL
      {
        role: UserRole.COUNSELOR,
        permissions: [
          PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
          PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
        ],
      },
      // LEARNER gets basic analytics and learner dashboard URL
      {
        role: UserRole.LEARNER,
        permissions: [
          PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
          PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
        ],
      },
    ];

    // 5. Assign permissions to groups (only missing ones)
    for (const mapping of analyticsPermissionMappings) {
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
    // Remove analytics permissions that were added by this migration
    const analyticsPermissions = [
      PERMISSIONS.VIEW_ANALYTICS_DASHBOARD,
      PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL,
    ];

    await queryRunner.query(
      `DELETE FROM group_permissions WHERE "permissionId" IN (
        SELECT id FROM "permissions" WHERE name IN (${analyticsPermissions.map((_, index) => `$${index + 1}`).join(',')})
      )`,
      analyticsPermissions,
    );

    // Note: We don't remove the permissions themselves as they might be used by other groups
    // Only remove them if they're not used by any other groups
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN (${analyticsPermissions.map((_, index) => `$${index + 1}`).join(',')}) AND id NOT IN (
        SELECT DISTINCT "permissionId" FROM group_permissions
      )`,
      analyticsPermissions,
    );
  }
}
