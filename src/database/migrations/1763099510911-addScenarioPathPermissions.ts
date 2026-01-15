import { MigrationInterface, QueryRunner } from 'typeorm';

enum UserRole {
  LEARNER = 'LEARNER',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

const PERMISSIONS = {
  VIEW_ADMIN_SCENARIO_PATHS: 'view:admin:scenario-paths',
  VIEW_ADMIN_SCENARIO_PATH: 'view:admin:scenario-path',
  EDIT_ADMIN_SCENARIO_PATH: 'edit:admin:scenario-path',
  DELETE_ADMIN_SCENARIO_PATH: 'delete:admin:scenario-path',
  EDIT_TENANT_SCENARIO_PATH: 'edit:tenant:scenario-path',
  VIEW_SCENARIO_PATHS: 'view:scenario-paths',
  VIEW_SCENARIO_PATH: 'view:scenario-path',
  EDIT_SCENARIO_PATH: 'edit:scenario-path',
};

export class AddScenarioPathPermissions1763099510911 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add all scenario path permissions to the permissions table
    const scenarioPathPermissions = [
      PERMISSIONS.VIEW_ADMIN_SCENARIO_PATHS,
      PERMISSIONS.VIEW_ADMIN_SCENARIO_PATH,
      PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH,
      PERMISSIONS.DELETE_ADMIN_SCENARIO_PATH,
      PERMISSIONS.EDIT_TENANT_SCENARIO_PATH,
      PERMISSIONS.VIEW_SCENARIO_PATHS,
      PERMISSIONS.VIEW_SCENARIO_PATH,
      PERMISSIONS.EDIT_SCENARIO_PATH,
    ];

    for (const permissionName of scenarioPathPermissions) {
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

    // 2. Get group IDs for LEARNER and SUPER_ADMIN roles
    const roleGroups = [UserRole.LEARNER, UserRole.SUPER_ADMIN];
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

    // 3. Get permission IDs for scenario path permissions
    const permissions = await queryRunner.query(
      `
        SELECT id, name FROM "permissions" WHERE name IN (${scenarioPathPermissions
          .map((_, index) => `$${index + 1}`)
          .join(',')})
      `,
      scenarioPathPermissions,
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

    // 4. Assign permissions to groups
    const permissionAssignments = [
      {
        role: UserRole.SUPER_ADMIN,
        permissions: [
          PERMISSIONS.VIEW_ADMIN_SCENARIO_PATHS,
          PERMISSIONS.VIEW_ADMIN_SCENARIO_PATH,
          PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH,
          PERMISSIONS.DELETE_ADMIN_SCENARIO_PATH,
          PERMISSIONS.EDIT_TENANT_SCENARIO_PATH,
        ],
      },
      {
        role: UserRole.LEARNER,
        permissions: [
          PERMISSIONS.VIEW_SCENARIO_PATHS,
          PERMISSIONS.VIEW_SCENARIO_PATH,
          PERMISSIONS.EDIT_SCENARIO_PATH,
        ],
      },
    ];

    for (const mapping of permissionAssignments) {
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
    // Remove group permissions for scenario path permissions
    const roleGroups = [UserRole.LEARNER, UserRole.SUPER_ADMIN];
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

    const scenarioPathPermissions = [
      PERMISSIONS.VIEW_ADMIN_SCENARIO_PATHS,
      PERMISSIONS.VIEW_ADMIN_SCENARIO_PATH,
      PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH,
      PERMISSIONS.DELETE_ADMIN_SCENARIO_PATH,
      PERMISSIONS.EDIT_TENANT_SCENARIO_PATH,
      PERMISSIONS.VIEW_SCENARIO_PATHS,
      PERMISSIONS.VIEW_SCENARIO_PATH,
      PERMISSIONS.EDIT_SCENARIO_PATH,
    ];

    const permissions = await queryRunner.query(
      `
        SELECT id, name FROM "permissions" WHERE name IN (${scenarioPathPermissions
          .map((_, index) => `$${index + 1}`)
          .join(',')})
      `,
      scenarioPathPermissions,
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

    // Remove group permissions
    for (const role of roleGroups) {
      const groupId = groupMap[role];
      if (!groupId) continue;

      for (const permissionName of scenarioPathPermissions) {
        const permissionId = permissionMap[permissionName];
        if (!permissionId) continue;

        await queryRunner.query(
          `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );
      }
    }

    // Remove permissions from permissions table (only if not used by other groups)
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name IN (${scenarioPathPermissions.map((_, index) => `$${index + 1}`).join(',')}) AND id NOT IN (
        SELECT DISTINCT "permissionId" FROM group_permissions
      )`,
      scenarioPathPermissions,
    );
  }
}
