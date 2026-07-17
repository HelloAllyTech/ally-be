import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the Roleplay Studio v2 permissions and grants them all to the
 * SUPER_ADMIN group (same idempotent grant pattern as
 * 1806000000000-tenantAdminSettingsPermissions):
 *
 *  - view:roleplay-specs        → list/read specs, versions, drafts
 *  - edit:roleplay-spec         → create/edit/publish specs & versions
 *  - delete:roleplay-spec       → soft-delete a spec (and its shell scenario)
 *  - edit:roleplay-copilot      → copilot sessions + streaming turns
 *  - view:roleplay-rehearsals   → read rehearsal runs/transcripts (+ socket)
 *  - edit:roleplay-rehearsals   → start/cancel rehearsals, request critiques
 *  - edit:roleplay-spec-tenant  → share/unshare a spec with tenants
 */
const SUPER_ADMIN_GROUP = 'SUPER_ADMIN';

const NEW_PERMISSIONS = [
  'view:roleplay-specs',
  'edit:roleplay-spec',
  'delete:roleplay-spec',
  'edit:roleplay-copilot',
  'view:roleplay-rehearsals',
  'edit:roleplay-rehearsals',
  'edit:roleplay-spec-tenant',
];

export class RoleplayStudioPermissions1817000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure the permission rows exist.
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

    // 2. Resolve the SUPER_ADMIN group id.
    const superAdminGroup = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [SUPER_ADMIN_GROUP],
    );
    const superAdminGroupId = superAdminGroup?.[0]?.id;
    if (!superAdminGroupId) return;

    // 3. Grant each permission to SUPER_ADMIN if not already granted.
    for (const name of NEW_PERMISSIONS) {
      const perm = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
        [name],
      );
      const permId = perm?.[0]?.id;
      if (!permId) continue;

      const existingGrant = await queryRunner.query(
        `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
        [superAdminGroupId, permId],
      );
      if (existingGrant.length === 0) {
        await queryRunner.query(
          `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
          [superAdminGroupId, permId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const superAdminGroup = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [SUPER_ADMIN_GROUP],
    );
    const superAdminGroupId = superAdminGroup?.[0]?.id;

    if (superAdminGroupId) {
      for (const name of NEW_PERMISSIONS) {
        await queryRunner.query(
          `DELETE FROM group_permissions
             WHERE "groupId" = $1
               AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
          [superAdminGroupId, name],
        );
      }
    }

    // Drop the permission rows only if no group still references them.
    await queryRunner.query(
      `DELETE FROM "permissions"
         WHERE name IN ($1, $2, $3, $4, $5, $6, $7)
           AND id NOT IN (SELECT DISTINCT "permissionId" FROM group_permissions)`,
      NEW_PERMISSIONS,
    );
  }
}
