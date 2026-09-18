import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Builder permissions and grants them to SUPER_ADMIN and
 * SUPER_DUPER_ADMIN.
 *
 * Both explicitly: the `...SUPER_ADMIN_PERMISSIONS` spread in
 * permissions.constants.ts is TypeScript only — `group_permissions` rows are
 * written once by migration and never recomputed, so SUPER_DUPER_ADMIN does
 * not inherit a SUPER_ADMIN grant at the database level. Idempotent and safe
 * to run everywhere.
 *
 * The feature toggle itself needs no migration: `admin_feature_toggles` is a
 * per-user row table where a missing row means false, and the toggle editor
 * reads the FEATURE_TOGGLES registry array.
 */
const GROUPS = ['SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];

const BUILDER_PERMISSIONS = ['view:admin:builder', 'edit:admin:builder'];

export class AddBuilderPermissions1937200000000 implements MigrationInterface {
  name = 'AddBuilderPermissions1937200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of BUILDER_PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
        [name],
      );
      if (existing.length === 0) {
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
      // No-op where the group doesn't exist on this environment.
      if (!groupId) continue;

      for (const name of BUILDER_PERMISSIONS) {
        const permission = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permissionId = permission?.[0]?.id;
        if (!permissionId) continue;

        const existingGrant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permissionId],
        );
        if (existingGrant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permissionId],
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

      for (const name of BUILDER_PERMISSIONS) {
        await queryRunner.query(
          `DELETE FROM group_permissions
             WHERE "groupId" = $1
               AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
          [groupId, name],
        );
      }
    }

    await queryRunner.query(`DELETE FROM "permissions" WHERE name = ANY($1)`, [
      BUILDER_PERMISSIONS,
    ]);
  }
}
