import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grants the tenant-level ADMIN role the permissions needed to manage the
 * content-access assignments a SUPER_ADMIN manages — but ONLY for their own
 * tenant. Every assign/unassign + per-tenant GET endpoint these permissions
 * unlock is additionally protected by OwnTenantScopeGuard, which pins a
 * non-SYSTEM_ACCESS caller to the tenant baked into their JWT. So these grants
 * can never be used to touch another tenant.
 *
 * Covers: scenarios, scenario-paths, cases, badges (assignment only).
 *
 * New permission introduced here:
 *  - edit:badge-tenant  → assign/unassign a badge to/from a tenant. Split out
 *    from edit:admin:badges (which also gates GLOBAL badge create/edit/delete)
 *    so a tenant ADMIN gets assignment WITHOUT global badge CRUD.
 *
 * All other permission names below already exist (they are held by SUPER_ADMIN);
 * they are (re-)ensured idempotently and granted to ADMIN.
 *
 * edit:badge-tenant is also granted to SUPER_ADMIN to match the code constants.
 */
const ADMIN_GROUP = 'ADMIN';
const SUPER_ADMIN_GROUP = 'SUPER_ADMIN';

// The one brand-new permission this migration introduces.
const NEW_PERMISSIONS = ['edit:badge-tenant'];

// Full set of access-management permissions granted to the ADMIN group.
const ADMIN_GRANTS = [
  // Scenarios
  'view:admin:scenarios',
  'view:admin:scenario',
  'edit:scenario-tenant',
  'delete:scenario-tenant',
  // Scenario paths
  'view:admin:scenario-paths',
  'view:admin:scenario-path',
  'edit:scenario-path-tenant',
  'delete:scenario-path-tenant',
  // Cases
  'view:admin:cases',
  'edit:case-tenant',
  'delete:case-tenant',
  // Badges (assignment + read, NOT global badge CRUD)
  'view:admin:badges',
  'view:admin:badges-for-setting',
  'edit:badge-tenant',
];

// Permissions granted to SUPER_ADMIN by this migration (new perm only).
const SUPER_ADMIN_GRANTS = ['edit:badge-tenant'];

// Permission names this migration is responsible for creating, so down() knows
// which perm rows are safe to consider for removal.
const ALL_PERMISSIONS = Array.from(
  new Set([...NEW_PERMISSIONS, ...ADMIN_GRANTS, ...SUPER_ADMIN_GRANTS]),
);

async function grantToGroup(
  queryRunner: QueryRunner,
  groupName: string,
  permissionNames: string[],
): Promise<void> {
  const group = await queryRunner.query(
    `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
    [groupName],
  );
  const groupId = group?.[0]?.id;
  if (!groupId) return;

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

async function revokeFromGroup(
  queryRunner: QueryRunner,
  groupName: string,
  permissionNames: string[],
): Promise<void> {
  const group = await queryRunner.query(
    `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
    [groupName],
  );
  const groupId = group?.[0]?.id;
  if (!groupId) return;

  for (const name of permissionNames) {
    await queryRunner.query(
      `DELETE FROM group_permissions
         WHERE "groupId" = $1
           AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
      [groupId, name],
    );
  }
}

export class TenantAdminAccessMgmtPermissions1807000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Ensure every referenced permission row exists (idempotent).
    for (const name of ALL_PERMISSIONS) {
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

    // 2. Grant the access-management permissions to ADMIN.
    await grantToGroup(queryRunner, ADMIN_GROUP, ADMIN_GRANTS);

    // 3. Grant the new edit:badge-tenant permission to SUPER_ADMIN so the
    //    role's badge-assignment ability matches the code constants.
    await grantToGroup(queryRunner, SUPER_ADMIN_GROUP, SUPER_ADMIN_GRANTS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revoke only what this migration granted to ADMIN. These view:/edit: perms
    // are otherwise unused by ADMIN today, so revoking is safe. If any were
    // granted to ADMIN independently later, this could over-revoke — acceptable
    // for a down migration.
    await revokeFromGroup(queryRunner, ADMIN_GROUP, ADMIN_GRANTS);

    // Revoke edit:badge-tenant from SUPER_ADMIN.
    await revokeFromGroup(queryRunner, SUPER_ADMIN_GROUP, SUPER_ADMIN_GRANTS);

    // Drop only the brand-new permission row(s), and only if nothing still
    // references them. Pre-existing permission rows are left untouched.
    await queryRunner.query(
      `DELETE FROM "permissions"
         WHERE name = ANY($1)
           AND id NOT IN (SELECT DISTINCT "permissionId" FROM group_permissions)`,
      [NEW_PERMISSIONS],
    );
  }
}
