import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Follow-up to 1830000000000-BlogPermissions.
 *
 * That migration granted the blog permissions (view:blogs / edit:blog /
 * delete:blog) only to the SUPER_ADMIN group. SUPER_DUPER_ADMIN (introduced in
 * 1828000000000-AddSuperDuperAdminRole) is a peer super-admin whose group only
 * receives permissions explicitly granted to it — it does NOT auto-inherit new
 * grants made to SUPER_ADMIN. As a result a SUPER_DUPER_ADMIN user saw no Blog
 * tab and would hit 403s on the admin blog API.
 *
 * This migration grants the same three permissions to SUPER_DUPER_ADMIN. It is
 * a separate migration (not an edit of 1830) because 1830 has already shipped
 * and run in environments; editing a run migration is a no-op there. Idempotent
 * and safe to run everywhere.
 */
const GROUP = 'SUPER_DUPER_ADMIN';

const BLOG_PERMISSIONS = ['view:blogs', 'edit:blog', 'delete:blog'];

export class GrantBlogPermissionsToSuperDuperAdmin1831000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const group = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [GROUP],
    );
    const groupId = group?.[0]?.id;
    // No-op where the group doesn't exist (e.g. envs that never ran 1828).
    if (!groupId) return;

    for (const name of BLOG_PERMISSIONS) {
      // The permission rows are created by 1830; ensure they exist to stay
      // self-contained if run out of order.
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    const group = await queryRunner.query(
      `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
      [GROUP],
    );
    const groupId = group?.[0]?.id;
    if (!groupId) return;

    for (const name of BLOG_PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM group_permissions
           WHERE "groupId" = $1
             AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
        [groupId, name],
      );
    }
    // Leaves the permission rows in place — 1830 owns their lifecycle.
  }
}
