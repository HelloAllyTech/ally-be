import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grants the tenant-level ADMIN role the permissions needed to view and edit
 * the settings of THEIR OWN tenant (the consumer-app "Org. Settings" screen,
 * mirroring the super-admin tenant-settings screen). Server-side scoping in the
 * services/controllers ensures a tenant admin can only ever affect their own
 * tenant — these permissions never let them touch another tenant.
 *
 * New permissions introduced here:
 *  - view:own-tenant:settings  → GET   /v1/tenants/self
 *  - edit:own-tenant:settings  → PATCH /v1/tenants/self/settings
 *
 * Existing permissions (re-)granted to ADMIN idempotently:
 *  - edit:settings:summary-fields       (summary sections + fields editing)
 *  - view:settings:custom-field-types
 *  - edit:settings:custom-field-types   (custom fields / scribe-note-creation)
 */
const ADMIN_GROUP = 'ADMIN';

// Permission names that must exist in the permissions table before granting.
const NEW_PERMISSIONS = [
  'view:own-tenant:settings',
  'edit:own-tenant:settings',
];

// Full set of permissions this migration grants to the ADMIN group.
const ADMIN_GRANTS = [
  'edit:settings:summary-fields',
  'view:settings:custom-field-types',
  'edit:settings:custom-field-types',
  'view:own-tenant:settings',
  'edit:own-tenant:settings',
];

export class TenantAdminSettingsPermissions1806000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure the new permission rows exist.
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

    // 2. Resolve the ADMIN group id.
    const adminGroup = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [ADMIN_GROUP],
    );
    const adminGroupId = adminGroup?.[0]?.id;
    if (!adminGroupId) return;

    // 3. Grant each permission to ADMIN if not already granted.
    for (const name of ADMIN_GRANTS) {
      const perm = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
        [name],
      );
      const permId = perm?.[0]?.id;
      if (!permId) continue;

      const existingGrant = await queryRunner.query(
        `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
        [adminGroupId, permId],
      );
      if (existingGrant.length === 0) {
        await queryRunner.query(
          `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
          [adminGroupId, permId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const adminGroup = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [ADMIN_GROUP],
    );
    const adminGroupId = adminGroup?.[0]?.id;

    if (adminGroupId) {
      // Only revoke the permissions this migration is responsible for adding.
      // edit:settings:custom-field-types / view:settings:custom-field-types are
      // left in place — they may have been granted to ADMIN independently.
      const revoke = [
        'edit:settings:summary-fields',
        'view:own-tenant:settings',
        'edit:own-tenant:settings',
      ];
      for (const name of revoke) {
        await queryRunner.query(
          `DELETE FROM group_permissions
             WHERE "groupId" = $1
               AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
          [adminGroupId, name],
        );
      }
    }

    // Drop the new permission rows only if no group still references them.
    await queryRunner.query(
      `DELETE FROM "permissions"
         WHERE name IN ($1, $2)
           AND id NOT IN (SELECT DISTINCT "permissionId" FROM group_permissions)`,
      NEW_PERMISSIONS,
    );
  }
}
