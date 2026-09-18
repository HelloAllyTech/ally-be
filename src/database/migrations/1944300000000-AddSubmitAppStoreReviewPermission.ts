import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permission for the new manual "submit for App Store review" action on the
 * Mobile Releases admin page (SDA-only): dispatches
 * submit-ios-app-store-review.yml on HelloAllyTech/ally-mobile, which
 * submits the current iOS build for Apple's FULL App Store review (real
 * public distribution to every App Store user, not TestFlight). The
 * workflow forces releaseType MANUAL, so an approval still requires a human
 * to explicitly release afterward — but the submission itself is real and
 * consequential, starting Apple's review clock. Deliberately its own tier,
 * separate from promote:mobile-releases (migration 1944000000000) — Android
 * production promotion and iOS App Store review submission are different
 * actions with different risk profiles, even though both are
 * SUPER_DUPER_ADMIN-only today. Granted ONLY to SUPER_DUPER_ADMIN, same
 * divergence pattern as AddViewAwsLogsPermission.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*`
 * with a 30-minute TTL (src/authorization/service/permissions.service.ts) —
 * flush those keys after deploying this migration or the new endpoint will
 * 403 until the cache expires.
 */
const NEW_PERMISSIONS = ['submit-app-store-review:mobile-releases'];

const GROUP_GRANTS: Record<string, string[]> = {
  SUPER_DUPER_ADMIN: NEW_PERMISSIONS,
};

export class AddSubmitAppStoreReviewPermission1944300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of NEW_PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

    for (const [groupName, permissionNames] of Object.entries(GROUP_GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of permissionNames) {
        const perm = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permId = perm?.[0]?.id;
        if (!permId) continue;

        const existingGrant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permId],
        );
        if (existingGrant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [NEW_PERMISSIONS],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      NEW_PERMISSIONS,
    ]);
  }
}
