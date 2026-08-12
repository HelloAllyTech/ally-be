import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permissions for the WhatsApp Q&A knowledge corpus (super-duper-admin-only).
 *
 * Granted ONLY to SUPER_DUPER_ADMIN, the same divergence as
 * AddViewAwsLogsPermission1887000000000. The reasoning is stronger here than for logs: the corpus
 * is what the bot tells mental healthcare workers, so an unreviewed edit reaches every worker who
 * asks a related question, and an archive silently removes guidance without leaving a trace in the
 * answer.
 *
 * The `...SUPER_ADMIN_PERMISSIONS` spread in permissions.constants.ts is TypeScript only —
 * `group_permissions` rows are written once by migration and never recomputed — so these explicit
 * grants are the actual grant. Adding the constant without this migration grants nothing.
 *
 * NOTE: group permissions are cached in Redis under `*group:permissions:*` with a 30-minute TTL
 * (src/authorization/service/permissions.service.ts) — flush those keys after deploying or the new
 * endpoints will 403 until the cache expires.
 */
const NEW_PERMISSIONS = [
  'view:knowledge-base',
  'edit:knowledge-base',
  'upload:knowledge-base',
  'edit:knowledge-base:archive',
];

const GROUP_GRANTS: Record<string, string[]> = {
  SUPER_DUPER_ADMIN: NEW_PERMISSIONS,
};

export class AddKnowledgeBasePermissions1892000000007 implements MigrationInterface {
  name = 'AddKnowledgeBasePermissions1892000000007';

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
