import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces a second super-admin tier: SUPER_DUPER_ADMIN.
 *
 * For now SUPER_DUPER_ADMIN is a strict peer of SUPER_ADMIN — it is granted the
 * exact same permission set (cloned from SUPER_ADMIN at migration time) and all
 * name-based SUPER_ADMIN gates in code accept both roles (see SUPER_ADMIN_ROLES
 * in src/common/constants/user.constants.ts). The intent is that it will gain
 * extra, super-admin-only capabilities later.
 *
 * This migration also promotes a single named user from SUPER_ADMIN to
 * SUPER_DUPER_ADMIN. The reassignment is keyed on the user's email and is a
 * no-op in any environment where that account does not exist (e.g. fresh local
 * databases), so it is safe to run everywhere. It is idempotent.
 *
 * NOTE: role/permission lookups are cached in Redis (`user:groups:<id>`,
 * `user:roles:<id>`, `group:permissions:<groupId>`). A raw migration cannot bust
 * that cache, so the promoted user may not see the change until the cached
 * entries expire. All three now carry a 30-min TTL, but for an immediate effect
 * flush those keys after deploying (e.g. `redis-cli --scan --pattern
 * '*user:roles:*' | xargs -r redis-cli del`).
 */
const NEW_GROUP = 'SUPER_DUPER_ADMIN';
const SOURCE_GROUP = 'SUPER_ADMIN';
const PROMOTE_EMAIL = 'sandeep.malhotra@helloally.ai';

export class AddSuperDuperAdminRole1828000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the SUPER_DUPER_ADMIN group (groups.name has no unique
    //    constraint, so guard with NOT EXISTS to stay idempotent).
    await queryRunner.query(
      `
      INSERT INTO "groups" ("name")
      SELECT $1::character varying
      WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = $1)
      `,
      [NEW_GROUP],
    );

    // 2. Clone every permission SUPER_ADMIN currently holds onto
    //    SUPER_DUPER_ADMIN (skipping any it already has).
    await queryRunner.query(
      `
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT sdg.id, gp."permissionId"
      FROM "group_permissions" gp
      JOIN "groups" sag ON sag.id = gp."groupId" AND sag.name = $2
      CROSS JOIN "groups" sdg
      WHERE sdg.name = $1
      AND NOT EXISTS (
        SELECT 1 FROM "group_permissions" existing
        WHERE existing."groupId" = sdg.id
        AND existing."permissionId" = gp."permissionId"
      )
      `,
      [NEW_GROUP, SOURCE_GROUP],
    );

    // 3. Promote the named user: add SUPER_DUPER_ADMIN, then drop SUPER_ADMIN.
    //    No-op if the user is absent in this environment.
    await queryRunner.query(
      `
      INSERT INTO "user_groups" ("userId", "groupId")
      SELECT u.id, sdg.id
      FROM "users" u
      CROSS JOIN "groups" sdg
      WHERE u.email = $1 AND sdg.name = $2
      AND NOT EXISTS (
        SELECT 1 FROM "user_groups" ug
        WHERE ug."userId" = u.id AND ug."groupId" = sdg.id
      )
      `,
      [PROMOTE_EMAIL, NEW_GROUP],
    );

    await queryRunner.query(
      `
      DELETE FROM "user_groups" ug
      USING "users" u, "groups" sag
      WHERE ug."userId" = u.id
      AND ug."groupId" = sag.id
      AND u.email = $1
      AND sag.name = $2
      `,
      [PROMOTE_EMAIL, SOURCE_GROUP],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Revert the promotion: restore SUPER_ADMIN, then drop SUPER_DUPER_ADMIN.
    await queryRunner.query(
      `
      INSERT INTO "user_groups" ("userId", "groupId")
      SELECT u.id, sag.id
      FROM "users" u
      CROSS JOIN "groups" sag
      WHERE u.email = $1 AND sag.name = $2
      AND NOT EXISTS (
        SELECT 1 FROM "user_groups" ug
        WHERE ug."userId" = u.id AND ug."groupId" = sag.id
      )
      `,
      [PROMOTE_EMAIL, SOURCE_GROUP],
    );

    await queryRunner.query(
      `
      DELETE FROM "user_groups" ug
      USING "users" u, "groups" sdg
      WHERE ug."userId" = u.id
      AND ug."groupId" = sdg.id
      AND u.email = $1
      AND sdg.name = $2
      `,
      [PROMOTE_EMAIL, NEW_GROUP],
    );

    // 2. Remove the cloned permissions and the group itself.
    await queryRunner.query(
      `
      DELETE FROM "group_permissions"
      WHERE "groupId" = (SELECT id FROM "groups" WHERE name = $1)
      `,
      [NEW_GROUP],
    );

    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [
      NEW_GROUP,
    ]);
  }
}
