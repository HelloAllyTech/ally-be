import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CreatePlatformAdminRole1895000000001 throws by design if it would produce
 * zero enabled 'admin_user_management' holders — a safety net against ever
 * locking every admin out of a real environment. But a genuinely empty
 * database (first-ever local setup, or CI) has zero users at all, so that
 * invariant can never be satisfied: `npm run seed` — which creates the real
 * dev admins, e.g. arjun.rao@helloally.ai as SUPER_DUPER_ADMIN — only runs
 * after every migration completes. That's a chicken-and-egg gap between "no
 * admin exists yet" and "the migration that requires one".
 *
 * This bootstraps exactly one throwaway SUPER_DUPER_ADMIN user, but ONLY
 * when SUPER_DUPER_ADMIN has zero members — a no-op in every environment
 * that already has one (prod, staging, or any dev DB seeded before),
 * following the same "safe everywhere" idiom as
 * AddSuperDuperAdminRole1828000000000's named-user promotion. Checking
 * SUPER_DUPER_ADMIN membership directly (rather than "any user exists") also
 * covers a database with other users but no admin yet. SUPER_DUPER_ADMIN
 * already carries a full permission set by this point in the migration chain
 * (cloned from SUPER_ADMIN in 1828000000000, independent of any user
 * existing) — it just has zero members on a fresh database, which is the gap
 * this closes.
 */
const BOOTSTRAP_EMAIL = 'bootstrap-local-admin@ally.internal';
const BOOTSTRAP_USERNAME = 'bootstrap-local-admin';
const SUPER_DUPER_ADMIN = 'SUPER_DUPER_ADMIN';

export class BootstrapLocalAdminOnEmptyDatabase1894999999999 implements MigrationInterface {
  name = 'BootstrapLocalAdminOnEmptyDatabase1894999999999';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(
      `
      SELECT COUNT(*)::int AS count
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId"
      WHERE g.name = $1
      `,
      [SUPER_DUPER_ADMIN],
    );
    if (count > 0) {
      return;
    }

    await queryRunner.query(
      `
      INSERT INTO "users" ("email", "username", "name", "status", "tenant_id")
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        BOOTSTRAP_EMAIL,
        BOOTSTRAP_USERNAME,
        'Bootstrap Admin',
        'ACTIVE',
        'default',
      ],
    );

    await queryRunner.query(
      `
      INSERT INTO "user_groups" ("userId", "groupId")
      SELECT u.id, g.id
      FROM "users" u
      CROSS JOIN "groups" g
      WHERE u.email = $1 AND g.name = $2
      `,
      [BOOTSTRAP_EMAIL, SUPER_DUPER_ADMIN],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      DELETE FROM "admin_feature_toggles"
      WHERE "userId" = (SELECT id FROM "users" WHERE email = $1)
      `,
      [BOOTSTRAP_EMAIL],
    );

    await queryRunner.query(
      `
      DELETE FROM "user_groups"
      WHERE "userId" = (SELECT id FROM "users" WHERE email = $1)
      `,
      [BOOTSTRAP_EMAIL],
    );

    await queryRunner.query(`DELETE FROM "users" WHERE email = $1`, [
      BOOTSTRAP_EMAIL,
    ]);
  }
}
