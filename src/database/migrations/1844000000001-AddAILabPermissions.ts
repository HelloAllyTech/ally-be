import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the AI Lab permissions and grants them to the SUPER_ADMIN and
 * SUPER_DUPER_ADMIN groups. The AI Lab admin tab is gated to SUPER_DUPER_ADMIN
 * in the frontend, but the backend guard checks permissions per-user; the
 * SUPER_DUPER_ADMIN group does NOT auto-inherit SUPER_ADMIN grants (see
 * 1831000000000-GrantBlogPermissionsToSuperDuperAdmin), so we grant to both
 * explicitly. Idempotent and safe to run everywhere.
 */
const GROUPS = ['SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];

const AI_LAB_PERMISSIONS = [
  'view:admin:ai-lab',
  'edit:admin:ai-lab',
  'delete:admin:ai-lab',
];

export class AddAILabPermissions1844000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of AI_LAB_PERMISSIONS) {
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

    for (const groupName of GROUPS) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      // No-op where the group doesn't exist (e.g. envs that never ran 1828).
      if (!groupId) continue;

      for (const name of AI_LAB_PERMISSIONS) {
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
    for (const groupName of GROUPS) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      if (!groupId) continue;

      for (const name of AI_LAB_PERMISSIONS) {
        await queryRunner.query(
          `DELETE FROM group_permissions
             WHERE "groupId" = $1
               AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
          [groupId, name],
        );
      }
    }

    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      AI_LAB_PERMISSIONS,
    ]);
  }
}
