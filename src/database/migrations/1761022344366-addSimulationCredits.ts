import { MigrationInterface, QueryRunner } from 'typeorm';

enum UserRole {
  LEARNER = 'LEARNER',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

const PERMISSIONS = {
  VIEW_SIMULATION_CREDITS: 'view:simulation-credits',
  EDIT_SIMULATION_CREDITS: 'edit:simulation-credits',
};

export class Migrations1761022344366 implements MigrationInterface {
  name = 'Migrations1761022344366';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create simulation_credits table
    await queryRunner.query(
      `CREATE TABLE "simulation_credits" (
        "id" SERIAL NOT NULL,
        "userId" integer NOT NULL,
        "creditLimit" integer NOT NULL DEFAULT 0,
        "consumedCredits" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_simulation_credits_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_simulation_credits_userId" UNIQUE ("userId")
      )`,
    );

    // Add permissions to permissions table
    const simulationPermissions = [
      PERMISSIONS.VIEW_SIMULATION_CREDITS,
      PERMISSIONS.EDIT_SIMULATION_CREDITS,
    ];

    for (const permissionName of simulationPermissions) {
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

    // Get group IDs for LEARNER and SUPER_ADMIN roles
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

    // Get permission IDs for simulation credits permissions
    const permissions = await queryRunner.query(
      `
        SELECT id, name FROM "permissions" WHERE name IN (${simulationPermissions
          .map((_, index) => `$${index + 1}`)
          .join(',')})
      `,
      simulationPermissions,
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

    // Assign permissions to groups
    const permissionAssignments = [
      {
        role: UserRole.LEARNER,
        permissions: [PERMISSIONS.VIEW_SIMULATION_CREDITS],
      },
      {
        role: UserRole.SUPER_ADMIN,
        permissions: [
          PERMISSIONS.VIEW_SIMULATION_CREDITS,
          PERMISSIONS.EDIT_SIMULATION_CREDITS,
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
    // Remove group permissions for simulation credits
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

    const simulationPermissions = [
      PERMISSIONS.VIEW_SIMULATION_CREDITS,
      PERMISSIONS.EDIT_SIMULATION_CREDITS,
    ];

    const permissions = await queryRunner.query(
      `
        SELECT id, name FROM "permissions" WHERE name IN (${simulationPermissions
          .map((_, index) => `$${index + 1}`)
          .join(',')})
      `,
      simulationPermissions,
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

      for (const permissionName of simulationPermissions) {
        const permissionId = permissionMap[permissionName];
        if (!permissionId) continue;

        await queryRunner.query(
          `DELETE FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );
      }
    }

    // Remove permissions from permissions table
    for (const permissionName of simulationPermissions) {
      await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
        permissionName,
      ]);
    }

    // Drop the simulation_credits table
    await queryRunner.query(`DROP TABLE "simulation_credits"`);
  }
}
