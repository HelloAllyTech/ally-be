import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grants the existing edit:global-settings permission (created by
 * 1771919926382-addGlobalSettingsPermissions.ts, SUPER_ADMIN-only) to
 * SUPER_DUPER_ADMIN as well, so the Mobile Releases admin page's new
 * "minimum supported app version" (force-update threshold) control can use
 * the app-version module's existing PUT /v1/app-version/app-version endpoint
 * directly rather than duplicating that logic behind a new permission.
 * SUPER_DUPER_ADMIN's permission set is a deliberate superset of
 * SUPER_ADMIN's elsewhere in this codebase (see SUPER_DUPER_ADMIN_PERMISSIONS
 * spreading ...SUPER_ADMIN_PERMISSIONS in permissions.constants.ts) but that
 * TypeScript array is not itself the source of truth for what's actually
 * granted — group_permissions rows are written once by migration and never
 * recomputed from it, and this specific permission's original migration only
 * ever granted SUPER_ADMIN.
 *
 * The permission row itself already exists and is still needed by
 * SUPER_ADMIN, so `down` only removes the new SUPER_DUPER_ADMIN grant, never
 * the shared permissions row.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL (src/authorization/service/permissions.service.ts) —
 * flush those keys after deploying this migration or the new control will
 * 403 until the cache expires.
 */
const PERMISSION_NAME = 'edit:global-settings';
const GROUP_NAME = 'SUPER_DUPER_ADMIN';

export class GrantGlobalSettingsPermissionToSuperDuperAdmin1944400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const permission = await queryRunner.query(
      `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
      [PERMISSION_NAME],
    );
    const permissionId = permission?.[0]?.id;
    if (!permissionId) return;

    const group = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [GROUP_NAME],
    );
    const groupId = group?.[0]?.id;
    if (!groupId) return;

    const existingGrant = await queryRunner.query(
      `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
      [groupId, permissionId],
    );
    if (existingGrant.length === 0) {
      await queryRunner.query(
        `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
        [groupId, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM group_permissions
       WHERE "permissionId" = (SELECT id FROM "permissions" WHERE name = $1)
         AND "groupId" = (SELECT id FROM "groups" WHERE name = $2)`,
      [PERMISSION_NAME, GROUP_NAME],
    );
  }
}
