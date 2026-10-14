import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course Copilot access: the two permissions and the `course_copilot` toggle.
 *
 * Release 1 is platform-tier only (plan §1.2). The permissions go to the
 * platform-tier groups that can still hold them — PLATFORM_ADMIN plus the two
 * retired super-admin groups whose `user_groups` rows the role collapse left in
 * place. Each is granted explicitly: the `...SUPER_ADMIN_PERMISSIONS` spread in
 * permissions.constants.ts is TypeScript only, and `group_permissions` rows
 * are written once by migration and never recomputed. MULTI_TENANT_ADMIN is
 * deliberately left out: a tenant-restricted admin generating library content
 * that is not tenant-scoped is the tenant-admin release's problem, not this
 * one's.
 *
 * The toggle is backfilled ON for the same groups. A new key grants itself to
 * nobody — `admin_feature_toggles` is a per-user row table where a missing row
 * means false, and `legacyGrants` is inert after the role-collapse cutover —
 * so without this the surface would ship invisible. It stays per-admin: anyone
 * can be switched off from Admin User Management afterwards.
 *
 * The lists are written out rather than imported: a migration must keep
 * meaning what it meant when it ran.
 *
 * NOTE: permissions are cached in Redis (`group:permissions:*`, 30-minute TTL)
 * and toggles under `admin:feature-toggles:${userId}`; raw SQL cannot bust
 * either. Admins active at deploy time see the tab within the TTL.
 */
const GROUPS = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];

const PERMISSIONS = ['view:admin:course-copilot', 'edit:admin:course-copilot'];

const FEATURE_KEY = 'course_copilot';

export class AddCourseCopilotAccess1977710000000 implements MigrationInterface {
  name = 'AddCourseCopilotAccess1977710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permissions" (name)
         SELECT $1::character varying
         WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1)`,
        [name],
      );
    }

    await queryRunner.query(
      `
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g
      JOIN "permissions" p ON p.name = ANY($2::character varying[])
      WHERE g.name = ANY($1::character varying[])
        AND NOT EXISTS (
          SELECT 1 FROM "group_permissions" gp
          WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
        )
      `,
      [GROUPS, PERMISSIONS],
    );

    await queryRunner.query(
      `
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT DISTINCT ug."userId", $2::character varying, true
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
      ON CONFLICT ("userId", "featureKey") DO NOTHING
      `,
      [GROUPS, FEATURE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1`,
      [FEATURE_KEY],
    );
    await queryRunner.query(
      `DELETE FROM "group_permissions"
        WHERE "permissionId" IN (SELECT id FROM "permissions" WHERE name = ANY($1))`,
      [PERMISSIONS],
    );
    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      PERMISSIONS,
    ]);
  }
}
