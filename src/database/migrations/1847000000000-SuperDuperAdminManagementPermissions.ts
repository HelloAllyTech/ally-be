import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permissions for the Super Duper Admin management surface — the dedicated
 * place for super duper admins to list/promote/demote other super duper
 * admins (replacing the one-off "Promote<Name>ToSuperDuperAdmin" migrations).
 *
 * Granted ONLY to SUPER_DUPER_ADMIN — intentionally NOT to SUPER_ADMIN. This
 * is the first divergence between the two super-admin tiers (see
 * SUPER_DUPER_ADMIN_PERMISSIONS in permissions.constants.ts).
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL (src/authorization/service/permissions.service.ts) —
 * flush those keys after deploying this migration or the new endpoints will
 * 403 until the cache expires.
 */
const NEW_PERMISSIONS = ['view:super-duper-admins', 'edit:super-duper-admins'];

const GROUP_GRANTS: Record<string, string[]> = {
  SUPER_DUPER_ADMIN: NEW_PERMISSIONS,
};

export class SuperDuperAdminManagementPermissions1847000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of NEW_PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

    for (const [groupName, permissionNames] of Object.entries(GROUP_GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of permissionNames) {
        const perm = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permId = perm?.[0]?.id;
        if (!permId) continue;

        const existingGrant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permId],
        );
        if (existingGrant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [NEW_PERMISSIONS],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      NEW_PERMISSIONS,
    ]);
  }
}
