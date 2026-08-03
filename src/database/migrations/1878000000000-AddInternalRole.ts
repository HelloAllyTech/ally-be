import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces the INTERNAL role — a strict clone of SUPER_ADMIN.
 *
 * INTERNAL exists so Ally staff can be given the super-admin console without
 * being listed (or manageable) as a super admin. It is granted the exact same
 * permission set as SUPER_ADMIN, cloned from the live rows at migration time,
 * and all name-based SUPER_ADMIN gates in code accept it (see SUPER_ADMIN_ROLES
 * in src/common/constants/user.constants.ts).
 *
 * The distinction is one of *surface*, not privilege: the API access INTERNAL
 * confers is identical to SUPER_ADMIN. What differs is where the holder signs
 * in — the console path-mounted on the consumer app at /admin rather than the
 * standalone admin dashboard. That surface split is enforced by the clients
 * (each sends its own `allowedRoles` list at login); this migration only
 * establishes the role and its grants.
 *
 * Unlike 1828000000000-AddSuperDuperAdminRole, this migration promotes nobody.
 * INTERNAL is assigned through the normal user-management role picker, and it
 * is additive — a user keeps LEARNER/COUNSELOR/etc. alongside it.
 *
 * NOTE: because group_permissions rows are static once written, any *future*
 * permission granted to SUPER_ADMIN must be granted to INTERNAL in the same
 * migration. The TypeScript spread in permissions.constants.ts does not
 * back-fill the database.
 *
 * NOTE: role/permission lookups are cached in Redis (`user:groups:<id>`,
 * `user:roles:<id>`, `group:permissions:<groupId>`). A raw migration cannot bust
 * that cache, so grants may not take effect until the cached entries expire
 * (30-min TTL). For an immediate effect, flush after deploying:
 *   redis-cli --scan --pattern '*group:permissions:*' | xargs -r redis-cli del
 *   redis-cli --scan --pattern '*user:groups:*'       | xargs -r redis-cli del
 *   redis-cli --scan --pattern '*user:roles:*'        | xargs -r redis-cli del
 */
const NEW_GROUP = 'INTERNAL';
const SOURCE_GROUP = 'SUPER_ADMIN';

export class AddInternalRole1878000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the INTERNAL group (groups.name has no unique constraint, so
    //    guard with NOT EXISTS to stay idempotent).
    await queryRunner.query(
      `
      INSERT INTO "groups" ("name")
      SELECT $1::character varying
      WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = $1)
      `,
      [NEW_GROUP],
    );

    // 2. Clone every permission SUPER_ADMIN currently holds onto INTERNAL
    //    (skipping any it already has).
    await queryRunner.query(
      `
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT ig.id, gp."permissionId"
      FROM "group_permissions" gp
      JOIN "groups" sag ON sag.id = gp."groupId" AND sag.name = $2
      CROSS JOIN "groups" ig
      WHERE ig.name = $1
      AND NOT EXISTS (
        SELECT 1 FROM "group_permissions" existing
        WHERE existing."groupId" = ig.id
        AND existing."permissionId" = gp."permissionId"
      )
      `,
      [NEW_GROUP, SOURCE_GROUP],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the group's memberships first so no user is left pointing at a
    // group that is about to disappear. Users who hold only INTERNAL end up
    // with no roles; that is the correct inverse of a migration that created
    // the role, and matches how the role could never have been assigned before
    // it existed.
    await queryRunner.query(
      `
      DELETE FROM "user_groups"
      WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)
      `,
      [NEW_GROUP],
    );

    await queryRunner.query(
      `
      DELETE FROM "group_permissions"
      WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)
      `,
      [NEW_GROUP],
    );

    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [
      NEW_GROUP,
    ]);
  }
}
