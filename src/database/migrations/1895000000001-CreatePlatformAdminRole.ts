import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  FEATURE_TOGGLES,
  FeatureToggleLegacyGrants,
} from '../../authorization/constants/admin-feature-toggle.constants';

/**
 * Collapses SUPER_ADMIN + SUPER_DUPER_ADMIN + MULTI_TENANT_ADMIN into a single
 * PLATFORM_ADMIN role, with per-user feature toggles (admin_feature_toggles,
 * created by the preceding migration) replacing the old tier hierarchy for the
 * ~21 surfaces that used to be gated by role name.
 *
 * Verified before writing this migration: MULTI_TENANT_ADMIN_PERMISSIONS is a
 * strict subset of SUPER_ADMIN_PERMISSIONS, and SUPER_DUPER_ADMIN_PERMISSIONS
 * is SUPER_ADMIN_PERMISSIONS plus SDA-exclusive additions. So the union of all
 * three roles' permissions is simply whatever SUPER_DUPER_ADMIN currently
 * holds in `group_permissions` — no dedup logic needed.
 *
 * Guarantee this migration must uphold: every migrated user's toggle set
 * reproduces their EXACT pre-migration effective access — a plain ex-SUPER_ADMIN
 * gets none of the SDA-exclusive toggles, an ex-SUPER_DUPER_ADMIN gets all of
 * them. This is why the toggle backfill (step 4) reads FEATURE_TOGGLES'
 * `legacyGrants` per key rather than blanket-enabling everything.
 *
 * Old groups (SUPER_ADMIN / SUPER_DUPER_ADMIN / MULTI_TENANT_ADMIN) and their
 * `user_groups`/`group_permissions` rows are intentionally left in place,
 * unreferenced by new code — rollback safety. A later, separate cleanup
 * migration removes them once the dual-gate rollout window (see
 * FeatureToggleGuard's `legacyRoles` escape hatch) has closed.
 *
 * NOTE: raw SQL cannot bust the 30-min Redis caches
 * (`user:roles:*`, `user:groups:*`, `group:permissions:*`,
 * `admin:feature-toggles:*`) — same caveat as
 * AddSuperDuperAdminRole1828000000000. Flush those key patterns after
 * deploying for an immediate effect; otherwise they self-heal within 30 min.
 */
const OLD_GROUPS = ['SUPER_ADMIN', 'SUPER_DUPER_ADMIN', 'MULTI_TENANT_ADMIN'];
const SOURCE_GROUP_FOR_PERMISSIONS = 'SUPER_DUPER_ADMIN';
const NEW_GROUP = 'PLATFORM_ADMIN';
const ADMIN_USER_MANAGEMENT_KEY = 'admin_user_management';

function legacyGroupNames(grants: FeatureToggleLegacyGrants): string[] {
  const names: string[] = [];
  if (grants.superAdmin) names.push('SUPER_ADMIN');
  if (grants.superDuperAdmin) names.push('SUPER_DUPER_ADMIN');
  if (grants.multiTenantAdmin) names.push('MULTI_TENANT_ADMIN');
  return names;
}

export class CreatePlatformAdminRole1895000000001 implements MigrationInterface {
  name = 'CreatePlatformAdminRole1895000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create the PLATFORM_ADMIN group (idempotent — groups.name has no
    //    unique constraint).
    await queryRunner.query(
      `
      INSERT INTO "groups" ("name")
      SELECT $1::character varying
      WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = $1)
      `,
      [NEW_GROUP],
    );

    // 2. Union of all three roles' permissions = SUPER_DUPER_ADMIN's current
    //    group_permissions rows (verified superset, see docstring above).
    await queryRunner.query(
      `
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT pa.id, gp."permissionId"
      FROM "group_permissions" gp
      JOIN "groups" src ON src.id = gp."groupId" AND src.name = $2
      CROSS JOIN "groups" pa
      WHERE pa.name = $1
      AND NOT EXISTS (
        SELECT 1 FROM "group_permissions" existing
        WHERE existing."groupId" = pa.id
        AND existing."permissionId" = gp."permissionId"
      )
      `,
      [NEW_GROUP, SOURCE_GROUP_FOR_PERMISSIONS],
    );

    // 3. Every user holding any of the 3 old groups gets exactly one
    //    PLATFORM_ADMIN membership (DISTINCT + NOT EXISTS makes this safe to
    //    re-run, and collapses a user holding 2-3 old roles to one new row).
    await queryRunner.query(
      `
      INSERT INTO "user_groups" ("userId", "groupId")
      SELECT DISTINCT ug."userId", pa.id
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($2::character varying[])
      CROSS JOIN "groups" pa
      WHERE pa.name = $1
      AND NOT EXISTS (
        SELECT 1 FROM "user_groups" existing
        WHERE existing."userId" = ug."userId" AND existing."groupId" = pa.id
      )
      `,
      [NEW_GROUP, OLD_GROUPS],
    );

    // 4. Backfill admin_feature_toggles, one insert-select per registry key,
    //    reading legacyGrants to decide which old-group members get
    //    enabled=true. A user who held e.g. both SUPER_ADMIN and
    //    MULTI_TENANT_ADMIN gets the union of both tiers' toggles (any one
    //    of their old roles granting a key is enough).
    for (const definition of FEATURE_TOGGLES) {
      const grantingGroups = legacyGroupNames(definition.legacyGrants);
      if (grantingGroups.length === 0) continue;

      await queryRunner.query(
        `
        INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
        SELECT DISTINCT ug."userId", $2::character varying, true
        FROM "user_groups" ug
        JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
        ON CONFLICT ("userId", "featureKey") DO NOTHING
        `,
        [grantingGroups, definition.key],
      );
    }

    // 5. Bootstrap check: admin_user_management must have at least one
    //    enabled holder post-migration, or no one could ever grant it going
    //    forward (no UI path to self-grant a toggle you don't hold).
    const [{ count }] = await queryRunner.query(
      `
      SELECT COUNT(*)::int AS count
      FROM "admin_feature_toggles"
      WHERE "featureKey" = $1 AND "enabled" = true
      `,
      [ADMIN_USER_MANAGEMENT_KEY],
    );
    if (count === 0) {
      throw new Error(
        `CreatePlatformAdminRole migration produced zero enabled '${ADMIN_USER_MANAGEMENT_KEY}' holders — ` +
          'aborting to avoid an unrecoverable lockout. Verify at least one SUPER_DUPER_ADMIN exists in this environment.',
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order: toggles, then user_groups, then group_permissions, then
    // the group itself. Old-group memberships were never touched, so no
    // restoration is needed there.
    await queryRunner.query(
      `
      DELETE FROM "admin_feature_toggles"
      WHERE "featureKey" = ANY($1::character varying[])
      `,
      [FEATURE_TOGGLES.map((d) => d.key)],
    );

    await queryRunner.query(
      `
      DELETE FROM "user_groups"
      WHERE "groupId" = (SELECT id FROM "groups" WHERE name = $1)
      `,
      [NEW_GROUP],
    );

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
