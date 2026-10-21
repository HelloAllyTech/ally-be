import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the `product_roadmap_quick_add` toggle ON for the three curators it was built for.
 *
 * Quick add files an opportunity straight onto the roadmap, skipping the guided interview and its
 * readiness gate. A new key grants itself to nobody — `admin_feature_toggles` is a per-user row
 * table where a missing row means false — and this one is deliberately NOT backfilled by group:
 * it is a shortcut for people who already know what belongs on the board, not a tier. Keyed on
 * email, like 1975200000000-RevokeProductRoadmapManageToggle; the `+admin` aliases are included
 * because those are the accounts actually used in the admin console (see
 * 1876000000000-PromoteGopiShortAliasesToSuperDuperAdmin). On a database without these accounts
 * (a fresh local seed) this is a no-op, which is harmless there.
 *
 * Idempotent: an existing row is switched on, never duplicated. Anyone else is granted — or any
 * of these three revoked — from Admin User Management afterwards.
 *
 * NOTE: FeatureToggleService caches enabled keys under `admin:feature-toggles:${userId}` for 30
 * minutes and raw SQL cannot bust it. The button appears within the TTL, or immediately after a
 * `DEL` of that prefix.
 */
const FEATURE_KEY = 'product_roadmap_quick_add';
const EMAILS = [
  'sandeep.malhotra@helloally.ai',
  'shubham.bhoite@helloally.ai',
  'shubham.bhoite+admin@helloally.ai',
  'gopi.s@helloally.ai',
  'gopi.s+admin@helloally.ai',
];

export class GrantProductRoadmapQuickAddToggle1978200000000 implements MigrationInterface {
  name = 'GrantProductRoadmapQuickAddToggle1978200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // TypeORM's postgres runner returns plain rows for INSERT ... RETURNING — the
    // [rows, rowCount] pair that 1975200000000-RevokeProductRoadmapManageToggle
    // destructures is UPDATE/DELETE-only.
    const granted: Array<{ userId: number }> = await queryRunner.query(
      `
        INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
        SELECT u.id, $1::character varying, true
        FROM "users" u
        WHERE lower(u.email) = ANY($2::character varying[])
        ON CONFLICT ("userId", "featureKey")
          DO UPDATE SET "enabled" = true, "updatedAt" = now()
        RETURNING "userId"
        `,
      [FEATURE_KEY, EMAILS.map((email) => email.toLowerCase())],
    );

    console.log(
      `[${this.name}] granted ${FEATURE_KEY} to ${granted.length} admin(s): ` +
        JSON.stringify(granted.map((row) => row.userId)),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles"
        WHERE "featureKey" = $1
          AND "userId" IN (
            SELECT id FROM "users" WHERE lower(email) = ANY($2::character varying[])
          )`,
      [FEATURE_KEY, EMAILS.map((email) => email.toLowerCase())],
    );
  }
}
