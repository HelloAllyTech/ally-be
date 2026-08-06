import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the INTERNAL role, reverting migration 1878000000000-AddInternalRole.
 *
 * INTERNAL was a permission-for-permission clone of SUPER_ADMIN whose only
 * purpose was a second surface: the admin console path-mounted at /admin on the
 * consumer app's origin. That surface has been withdrawn — Ally staff use
 * SUPER_ADMIN on the standalone admin dashboard — so the role has nothing left
 * to distinguish it and is dropped rather than left as an unreferenced group
 * that still carries full super-admin grants.
 *
 * The role was never assigned in production. The deletes below are written to
 * be safe regardless: any membership rows found are removed, which revokes
 * platform access from a holder rather than silently leaving it in place. If a
 * holder does turn up, grant them SUPER_ADMIN through the Super Admins tab.
 *
 * NOTE: role/permission lookups are cached in Redis (`user:groups:<id>`,
 * `user:roles:<id>`, `group:permissions:<groupId>`) with a 30-minute TTL. A raw
 * migration cannot bust that cache, so a stale entry could keep answering with
 * the removed role until it expires. For an immediate effect, flush after
 * deploying:
 *   redis-cli --scan --pattern '*group:permissions:*' | xargs -r redis-cli del
 *   redis-cli --scan --pattern '*user:groups:*'       | xargs -r redis-cli del
 *   redis-cli --scan --pattern '*user:roles:*'        | xargs -r redis-cli del
 */
const GROUP = 'INTERNAL';
const SOURCE_GROUP = 'SUPER_ADMIN';

export class RemoveInternalRole1885000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Memberships first, so no user is left pointing at a group that is about
    // to disappear.
    await queryRunner.query(
      `
      DELETE FROM "user_groups"
      WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)
      `,
      [GROUP],
    );

    await queryRunner.query(
      `
      DELETE FROM "group_permissions"
      WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)
      `,
      [GROUP],
    );

    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [GROUP]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Recreates the group and re-clones SUPER_ADMIN's live grants, matching
    // what 1878000000000-AddInternalRole did. Memberships are not restored —
    // they are not recorded anywhere once deleted — so a rollback brings back
    // an empty role, which is the state the original migration also left.
    await queryRunner.query(
      `
      INSERT INTO "groups" ("name")
      SELECT $1::character varying
      WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = $1)
      `,
      [GROUP],
    );

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
      [GROUP, SOURCE_GROUP],
    );
  }
}
