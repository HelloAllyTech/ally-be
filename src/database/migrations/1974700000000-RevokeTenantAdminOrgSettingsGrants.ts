import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Takes back from the tenant ADMIN group the permissions it was given for the
 * consumer app's "Org. Settings" screen — a tenant-admin mirror of the admin
 * console's per-tenant settings, removed from ally-web without ever leaving
 * alpha.
 *
 * That screen was gated in the frontend only, by an email allowlist, while the
 * grants behind it went to every tenant ADMIN (1806000000000, 1807000000000,
 * 1826000000000, 1925000000000). So all tenant admins could call these routes
 * directly, and with the screen gone nothing needs them to. Each one was checked
 * for a remaining caller in the consumer app and ally-mobile; none has one.
 *
 * Revoked from ADMIN only. The admin console reaches the same routes through
 * the platform-tier groups, whose grants are untouched, so every content-access,
 * badge, cohort and settings screen there keeps working.
 *
 * Kept on ADMIN, because a remaining feature reads them:
 *  - view:settings:summary-fields / view:settings:custom-field-types — the
 *    Scribe call summary reads its field and toggle config.
 *  - manage:custom-field:definitions — the Scribe "Manage custom fields"
 *    dialog on the call-logs page.
 *
 * `view:own-tenant:settings` and `edit:own-tenant:settings` existed only for
 * GET /v1/tenants/self and PATCH /v1/tenants/self/settings, which go with the
 * screen, so those two permissions are deleted outright.
 *
 * Cohorts already created stay in force for learners: restrictions are applied
 * by the content services, not by these permissions, and a platform admin can
 * still edit them from the admin console's Groups tab.
 *
 * Group permissions are cached in Redis for 30 minutes
 * (src/authorization/service/permissions.service.ts), so a revoked grant keeps
 * working until the cache expires unless `*group:permissions:*` is flushed.
 */
const REVOKED_FROM_ADMIN = [
  // Own-tenant settings writes (1806000000000, 1776500000000)
  'edit:settings:summary-fields',
  'edit:settings:custom-field-types',
  // Content-access management (1807000000000)
  'view:admin:scenarios',
  'view:admin:scenario',
  'edit:scenario-tenant',
  'delete:scenario-tenant',
  'view:admin:scenario-paths',
  'view:admin:scenario-path',
  'edit:scenario-path-tenant',
  'delete:scenario-path-tenant',
  'view:admin:cases',
  'edit:case-tenant',
  'delete:case-tenant',
  'view:admin:badges',
  'view:admin:badges-for-setting',
  'edit:badge-tenant',
  // Track 2.0 (1826000000000)
  'view:admin:tracks',
  'view:admin:track',
  'edit:track-tenant',
  'delete:track-tenant',
  // Cohorts (1925000000000)
  'view:cohorts',
  'edit:cohorts',
];

const DELETED = ['view:own-tenant:settings', 'edit:own-tenant:settings'];

export class RevokeTenantAdminOrgSettingsGrants1974700000000 implements MigrationInterface {
  name = 'RevokeTenantAdminOrgSettingsGrants1974700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM group_permissions
         WHERE "groupId" IN (SELECT id FROM groups WHERE name = 'ADMIN')
           AND "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [REVOKED_FROM_ADMIN],
    );
    await queryRunner.query(
      `DELETE FROM group_permissions
         WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [DELETED],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      DELETED,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of DELETED) {
      await queryRunner.query(
        `INSERT INTO "permissions" (name) SELECT $1::varchar
           WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
        [name],
      );
    }
    await queryRunner.query(
      `INSERT INTO group_permissions ("groupId", "permissionId")
         SELECT g.id, p.id
           FROM groups g
           JOIN "permissions" p ON p.name = ANY($1)
          WHERE g.name = 'ADMIN'
            AND NOT EXISTS (
              SELECT 1 FROM group_permissions gp
               WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
            )`,
      [[...REVOKED_FROM_ADMIN, ...DELETED]],
    );
  }
}
