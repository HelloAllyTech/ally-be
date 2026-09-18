import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Switches the new `ux_signals` toggle ON for super-duper-admins, so the feature
 * is reachable by the people who own it the moment it ships.
 *
 * Why this migration has to exist: `admin_feature_toggles` is a per-user row table
 * where a MISSING row means false, and `legacyGrants` in the FEATURE_TOGGLES
 * registry is read by exactly one already-run migration
 * (1895000000001-CreatePlatformAdminRole). For a key added after that cutover
 * `legacyGrants` is inert documentation — nothing backfills it. Ship the toggle
 * without this and the feature is invisible to everyone, including whoever needs
 * to verify it.
 *
 * SUPER_DUPER_ADMIN only, matching the key's SDA_ONLY grants. This is a narrower
 * grant than most analytics surfaces get, and deliberately so: a scan writes into
 * two other teams' queues, and until the detector thresholds have been tuned
 * against real output the people who can trigger one should be the people who can
 * judge whether its output is any good.
 *
 * Idempotent (ON CONFLICT DO NOTHING) and safe to re-run. A group absent from an
 * environment is simply skipped by the join.
 *
 * NOTE: FeatureToggleService caches enabled keys under
 * `admin:feature-toggles:${userId}` for 30 minutes and raw SQL cannot bust it.
 * Affected admins see the new toggle within the TTL, or immediately after a `DEL`
 * of that prefix.
 */
const GRANTED_GROUPS = ['SUPER_DUPER_ADMIN'];

const FEATURE_KEY = 'ux_signals';

export class BackfillUxSignalsToggle1940300000000 implements MigrationInterface {
  name = 'BackfillUxSignalsToggle1940300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT DISTINCT ug."userId", $2::character varying, true
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
      ON CONFLICT ("userId", "featureKey") DO NOTHING
      `,
      [GRANTED_GROUPS, FEATURE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1`,
      [FEATURE_KEY],
    );
  }
}
