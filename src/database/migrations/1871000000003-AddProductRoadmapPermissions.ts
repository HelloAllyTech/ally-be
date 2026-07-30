import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the three Product Roadmap permissions and grants them.
 *
 * The split is deliberate, because the roadmap is a voting board rather than a CRUD screen:
 *
 *   view:admin:product-roadmap  — see the tab, read opportunities/comments/notes.
 *   vote:admin:product-roadmap  — participate: file an opportunity, allocate your monthly
 *                                 coins, comment, keep your own saved views.
 *   edit:admin:product-roadmap  — manage: stage transitions, editing or deleting anyone's
 *                                 opportunity, the goal/owner taxonomy, split/merge,
 *                                 release notes, pinning a saved view for everyone.
 *
 * GRANTS:  VIEW + VOTE -> SUPER_ADMIN and SUPER_DUPER_ADMIN
 *          EDIT        -> SUPER_DUPER_ADMIN only
 *
 * Note the SUPER_DUPER_ADMIN group does NOT auto-inherit SUPER_ADMIN's grants at runtime —
 * the spread in permissions.constants.ts is TypeScript only (see
 * 1831000000000-GrantBlogPermissionsToSuperDuperAdmin and 1844000000001-AddAILabPermissions).
 * So VIEW and VOTE are granted to both groups explicitly.
 *
 * ⚠️  AFTER DEPLOYING THIS, FLUSH THE REDIS PERMISSION CACHES or the new endpoints will 403
 * for up to 30 minutes. Keys are set in src/authorization/service/permissions.service.ts:
 *   group:permissions:<groupId>, user:groups:<userId>, user:roles:<userId>   (30-min TTL)
 * A raw SQL migration cannot bust them. From a shell with redis access:
 *   redis-cli --scan --pattern '*group:permissions:*' | xargs -r redis-cli del
 *   redis-cli --scan --pattern '*user:groups:*'       | xargs -r redis-cli del
 *   redis-cli --scan --pattern '*user:roles:*'        | xargs -r redis-cli del
 *
 * Individual humans are NOT granted anything here. The standalone app kept its own
 * `allowed_emails` table (9 rows, including one external address); that concept is replaced
 * by these permissions, so access is granted through Ally's group/role admin — revocable,
 * auditable, and owned. See §12.1 of the plan.
 *
 * Idempotent and safe to run everywhere.
 */
const VIEW_AND_VOTE = [
  'view:admin:product-roadmap',
  'vote:admin:product-roadmap',
];
const EDIT_ONLY = ['edit:admin:product-roadmap'];
const ALL_PERMISSIONS = [...VIEW_AND_VOTE, ...EDIT_ONLY];

/** groupName -> the permissions that group should hold. */
const GRANTS: Record<string, string[]> = {
  SUPER_ADMIN: VIEW_AND_VOTE,
  SUPER_DUPER_ADMIN: [...VIEW_AND_VOTE, ...EDIT_ONLY],
};

export class AddProductRoadmapPermissions1871000000003 implements MigrationInterface {
  name = 'AddProductRoadmapPermissions1871000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of ALL_PERMISSIONS) {
      const existingPerm = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
        [name],
      );
      if (existingPerm.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

    for (const [groupName, permissionNames] of Object.entries(GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      // No-op where the group doesn't exist (e.g. envs that never ran 1828).
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
    for (const groupName of Object.keys(GRANTS)) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of ALL_PERMISSIONS) {
        await queryRunner.query(
          `DELETE FROM group_permissions
             WHERE "groupId" = $1
               AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
          [groupId, name],
        );
      }
    }

    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      ALL_PERMISSIONS,
    ]);
  }
}
