import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the new `content_management` toggle ON for every platform-tier
 * admin, so adding the gate takes Simulation Studio away from nobody.
 *
 * Why this migration has to exist at all: `admin_feature_toggles` is a
 * per-user row table where a MISSING row means false, and `legacyGrants` in
 * the FEATURE_TOGGLES registry is read by exactly one already-run migration
 * (1895000000001-CreatePlatformAdminRole). For a key added after that cutover
 * `legacyGrants` is inert documentation — nothing backfills it. Ship the gate
 * without this and every admin loses the studio.
 *
 * Why all four groups and not just the legacy super-admin pair: the gate this
 * replaces is ally-web's `isSuperAdminRole(user.role)`, which accepts only
 * SUPER_ADMIN and SUPER_DUPER_ADMIN. That is the bug being fixed — a
 * PLATFORM_ADMIN minted by the Ally admins tab holds every content permission
 * on the backend and still could not see the Tracks/Cases/Courses tabs.
 * MULTI_TENANT_ADMIN is included because one key now covers the Simulations
 * tab too, which they do have today; leaving them out would be a regression
 * dressed as a fix.
 *
 * Idempotent (ON CONFLICT DO NOTHING) and safe to re-run. A group absent from
 * an environment is simply skipped by the join.
 *
 * NOTE: FeatureToggleService caches enabled keys under
 * `admin:feature-toggles:${userId}` for 30 minutes and raw SQL cannot bust it.
 * Affected admins see the new toggle within the TTL, or immediately after a
 * `DEL` of that prefix.
 */
const PLATFORM_TIER_GROUPS = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'SUPER_DUPER_ADMIN',
  'MULTI_TENANT_ADMIN',
];

const FEATURE_KEY = 'content_management';

export class BackfillContentManagementToggle1938000000000
  implements MigrationInterface
{
  name = 'BackfillContentManagementToggle1938000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT DISTINCT ug."userId", $2::character varying, true
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
      ON CONFLICT ("userId", "featureKey") DO NOTHING
      `,
      [PLATFORM_TIER_GROUPS, FEATURE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1`,
      [FEATURE_KEY],
    );
  }
}
