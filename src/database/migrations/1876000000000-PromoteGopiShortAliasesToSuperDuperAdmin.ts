import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes gopi.s@helloally.ai and gopi.s+admin@helloally.ai from SUPER_ADMIN to
 * SUPER_DUPER_ADMIN, following 1840000000000-PromoteShubhamAdminToSuperDuperAdmin.
 *
 * The earlier promotions (1838, 1839) were keyed to the long-form addresses
 * `gopikrishnan.sasikumar@helloally.ai` / `…+admin@…`. The accounts actually in
 * use are the short `gopi.s` aliases, which those migrations never matched — so
 * the super-duper-admin-only tabs (Languages, Speech Recognition, Language
 * Model, Guardrails, Tooltips…) stayed hidden.
 *
 * The SUPER_DUPER_ADMIN group and its permission set already exist (created in
 * 1828000000000-AddSuperDuperAdminRole), so this only reassigns the users: add
 * the SUPER_DUPER_ADMIN membership, then drop SUPER_ADMIN.
 *
 * SUPER_ADMIN is dropped rather than kept alongside — deliberately, not just for
 * symmetry with 1840. The role the clients gate on is `roles[0].name`
 * (user.service.ts), and `findUserRoleByUserId` has no ORDER BY, so a user in
 * both groups gets a nondeterministic role claim that can resolve to
 * SUPER_ADMIN and leave the tabs hidden anyway.
 *
 * Keyed on email and idempotent; a no-op where an account or the group is absent
 * (e.g. fresh local databases), so it is safe to run everywhere. down() restores
 * SUPER_ADMIN.
 *
 * Because a silent no-op is indistinguishable from success without DB access,
 * this logs the resulting group membership per address — check the migration
 * task output to confirm it matched.
 *
 * NOTE: role/permission lookups are cached in Redis for ~30 min
 * (`user:groups:<id>`, `user:roles:<id>`, `group:permissions:<groupId>`). A raw
 * migration cannot bust that cache, so the promoted users may not see the change
 * until their cached entries expire — sign out and back in, or wait out the TTL.
 */
const NEW_GROUP = 'SUPER_DUPER_ADMIN';
const SOURCE_GROUP = 'SUPER_ADMIN';
const PROMOTE_EMAILS = ['gopi.s@helloally.ai', 'gopi.s+admin@helloally.ai'];

export class PromoteGopiShortAliasesToSuperDuperAdmin1876000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const email of PROMOTE_EMAILS) {
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
        [email, NEW_GROUP],
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
        [email, SOURCE_GROUP],
      );
    }

    // Diagnostics only — never let it fail the promotion. The DML above is the
    // proven 1840 pattern; this reporting query is new and unexercised, and a
    // migration that throws blocks the whole deploy.
    try {
      await this.reportMembership(queryRunner);
    } catch (error) {
      console.log(
        `[PromoteGopiShortAliases] membership report failed (promotion itself is unaffected): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const email of PROMOTE_EMAILS) {
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
        [email, SOURCE_GROUP],
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
        [email, NEW_GROUP],
      );
    }
  }

  /**
   * Log what each address ended up with, so a no-op (account missing in this
   * environment) is visible in the migration output instead of looking like a
   * successful promotion.
   */
  private async reportMembership(queryRunner: QueryRunner): Promise<void> {
    for (const email of PROMOTE_EMAILS) {
      const rows: Array<{ groups: string | null }> = await queryRunner.query(
        `
        SELECT string_agg(g.name, ',' ORDER BY g.name) AS groups
        FROM "users" u
        LEFT JOIN "user_groups" ug ON ug."userId" = u.id
        LEFT JOIN "groups" g ON g.id = ug."groupId"
        WHERE u.email = $1
        GROUP BY u.id
        `,
        [email],
      );

      if (rows.length === 0) {
        console.log(
          `[PromoteGopiShortAliases] ${email}: NO SUCH USER in this database — promotion was a no-op.`,
        );
      } else {
        console.log(
          `[PromoteGopiShortAliases] ${email}: groups = ${rows[0].groups ?? '(none)'}`,
        );
      }
    }
  }
}
