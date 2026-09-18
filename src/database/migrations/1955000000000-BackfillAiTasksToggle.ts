import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the new `ai_tasks` toggle ON for every platform-tier admin, so the
 * AI Tasks screen is visible the moment it ships.
 *
 * A new key grants itself to nobody: `admin_feature_toggles` is a per-user row
 * table where a MISSING row means false, and `legacyGrants` in the
 * FEATURE_TOGGLES registry is read by exactly one already-run migration
 * (1895000000001-CreatePlatformAdminRole). For any key added after that cutover
 * it is inert documentation — nothing backfills it.
 *
 * Unlike the content_management backfill, this one is not fixing a regression:
 * AI Tasks is a new surface nobody has today, so strictly it could ship dark
 * and be granted per-admin. It is backfilled anyway because a read-only
 * reference table carries no risk in being on, and a registry that nobody can
 * find is a registry that stops being maintained — which is the entire failure
 * mode this screen exists to prevent.
 *
 * Idempotent (ON CONFLICT DO NOTHING) and safe to re-run. A group absent from
 * an environment is simply skipped by the join. DISTINCT matters: admins
 * commonly hold several of these groups.
 *
 * NOTE: FeatureToggleService caches enabled keys under
 * `admin:feature-toggles:${userId}` for 30 minutes and raw SQL cannot bust it.
 * Affected admins see the tab within the TTL, or immediately after a `DEL` of
 * that prefix.
 */
const PLATFORM_TIER_GROUPS = [
  'PLATFORM_ADMIN',
  'SUPER_ADMIN',
  'SUPER_DUPER_ADMIN',
  'MULTI_TENANT_ADMIN',
];

const FEATURE_KEY = 'ai_tasks';

export class BackfillAiTasksToggle1955000000000 implements MigrationInterface {
  name = 'BackfillAiTasksToggle1955000000000';

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
