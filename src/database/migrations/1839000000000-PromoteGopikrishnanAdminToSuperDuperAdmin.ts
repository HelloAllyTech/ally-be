import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes gopikrishnan.sasikumar+admin@helloally.ai from SUPER_ADMIN to
 * SUPER_DUPER_ADMIN — the `+admin` peer of the account promoted in
 * 1838000000000-PromoteGopikrishnanToSuperDuperAdmin.
 *
 * The SUPER_DUPER_ADMIN group and its permission set already exist (created in
 * 1828000000000-AddSuperDuperAdminRole), so this only reassigns the user: add
 * the SUPER_DUPER_ADMIN membership, then drop SUPER_ADMIN.
 *
 * Keyed on email and idempotent; a no-op where the account or group is absent
 * (e.g. fresh local databases), so it is safe to run everywhere. down()
 * restores SUPER_ADMIN.
 *
 * NOTE: role/permission lookups are cached in Redis for ~30 min
 * (`user:groups:<id>`, `user:roles:<id>`, `group:permissions:<groupId>`). A raw
 * migration cannot bust that cache, so the promoted user may not see the change
 * until their cached entries expire — flush those keys (or wait out the TTL) if
 * an immediate effect is needed.
 */
const NEW_GROUP = 'SUPER_DUPER_ADMIN';
const SOURCE_GROUP = 'SUPER_ADMIN';
const PROMOTE_EMAIL = 'gopikrishnan.sasikumar+admin@helloally.ai';

export class PromoteGopikrishnanAdminToSuperDuperAdmin1839000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add SUPER_DUPER_ADMIN membership. No-op if the user or group is absent,
    // or if the membership already exists.
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

    // Drop SUPER_ADMIN membership.
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
    // Restore SUPER_ADMIN membership, then drop SUPER_DUPER_ADMIN.
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
  }
}
