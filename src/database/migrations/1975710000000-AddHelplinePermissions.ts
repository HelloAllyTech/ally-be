import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Text helpline roles and permissions (docs/text-helpline.md §2).
 *
 *  - LISTENER (new): the first eight helpline permissions.
 *  - HELPLINE_SUPERVISOR (new): LISTENER + monitor, whisper, transfer, QA.
 *  - ADMIN (existing, tenant-scoped): HELPLINE_SUPERVISOR + team management,
 *    so an org admin can supervise their own helpline and grant the two roles.
 *
 * Both new roles are additive: they sit alongside an account's normal app role
 * and carry nothing outside the helpline. Every listener route also requires
 * the tenant's TEXT_HELPLINE_ENABLED preference, so these grants open nothing
 * for an org that has not been switched on.
 *
 * The lists are written out rather than imported from permissions.constants.ts:
 * a migration must keep meaning what it meant when it ran, even after the
 * TypeScript lists change.
 *
 * NOTE: permissions are cached in Redis (`group:permissions:*`,
 * `user:groups:*`, `user:roles:*`, 30-minute TTL) and a raw SQL migration
 * cannot bust them, so ADMIN's new grants take up to 30 minutes to appear for
 * an admin who was active at deploy time. The two new groups start with no
 * holders, so they are unaffected.
 */
const LISTENER_GROUP = 'LISTENER';
const SUPERVISOR_GROUP = 'HELPLINE_SUPERVISOR';
const ADMIN_GROUP = 'ADMIN';

const LISTENER_PERMISSIONS = [
  'view:helpline:lobby',
  'edit:helpline:presence',
  'edit:helpline:claim',
  'view:helpline:chat',
  'edit:helpline:message',
  'edit:helpline:end',
  'view:helpline:copilot',
  'edit:helpline:summary',
];

const SUPERVISOR_PERMISSIONS = [
  ...LISTENER_PERMISSIONS,
  'view:helpline:monitor',
  'edit:helpline:whisper',
  'edit:helpline:transfer',
  'view:helpline:qa',
];

const ADMIN_PERMISSIONS = [...SUPERVISOR_PERMISSIONS, 'edit:helpline:team'];

const ALL_PERMISSIONS = ADMIN_PERMISSIONS;

export class AddHelplinePermissions1975710000000 implements MigrationInterface {
  name = 'AddHelplinePermissions1975710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `$1::varchar` rather than a bare `$1`: in `SELECT $1` Postgres has no
    // column to infer the parameter type from and rejects text vs varchar.
    for (const group of [LISTENER_GROUP, SUPERVISOR_GROUP]) {
      await queryRunner.query(
        `INSERT INTO "groups" ("name")
         SELECT $1::varchar
         WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE name = $1::varchar)`,
        [group],
      );
    }

    for (const permission of ALL_PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name")
         SELECT $1::varchar
         WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
        [permission],
      );
    }

    const grants: [string, string[]][] = [
      [LISTENER_GROUP, LISTENER_PERMISSIONS],
      [SUPERVISOR_GROUP, SUPERVISOR_PERMISSIONS],
      [ADMIN_GROUP, ADMIN_PERMISSIONS],
    ];
    for (const [group, permissions] of grants) {
      await queryRunner.query(
        `INSERT INTO "group_permissions" ("groupId", "permissionId")
         SELECT g.id, p.id
         FROM "groups" g
         JOIN "permissions" p ON p.name = ANY($2::varchar[])
         WHERE g.name = $1::varchar
           AND NOT EXISTS (
             SELECT 1 FROM "group_permissions" existing
             WHERE existing."groupId" = g.id
               AND existing."permissionId" = p.id
           )`,
        [group, permissions],
      );
    }
  }

  /**
   * Removes the helpline grants, the two roles and their assignments.
   *
   * Safe because both roles are additive: every holder also holds a normal app
   * role, so nobody is left role-less, and the permissions open nothing outside
   * the helpline.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions"
       WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1::varchar[]))`,
      [ALL_PERMISSIONS],
    );

    await queryRunner.query(
      `DELETE FROM "user_groups"
       WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = ANY($1::varchar[]))`,
      [[LISTENER_GROUP, SUPERVISOR_GROUP]],
    );

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE name = ANY($1::varchar[])`,
      [ALL_PERMISSIONS],
    );

    await queryRunner.query(
      `DELETE FROM "groups" WHERE name = ANY($1::varchar[])`,
      [[LISTENER_GROUP, SUPERVISOR_GROUP]],
    );
  }
}
