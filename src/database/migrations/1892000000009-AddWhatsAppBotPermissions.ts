import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permissions for the WhatsApp Q&A bot admin surface. SUPER_DUPER_ADMIN only.
 *
 * `view:whatsapp-bot:conversations` is the most sensitive permission this feature adds: those rows
 * hold mental healthcare workers' clinical questions next to their phone numbers. It is granted at
 * the same tier as `view:aws-logs` for the same reason.
 *
 * The `...SUPER_ADMIN_PERMISSIONS` spread in permissions.constants.ts is TypeScript only —
 * `group_permissions` rows are written once by migration and never recomputed — so these explicit
 * INSERTs are the actual grant.
 *
 * NOTE: group permissions sit behind a Redis cache (`*group:permissions:*`, 30-minute TTL) that raw
 * SQL cannot bust — flush those keys after deploying or every new endpoint 403s until it expires.
 */
const NEW_PERMISSIONS = [
  'view:whatsapp-bot',
  'edit:whatsapp-bot',
  'view:whatsapp-bot:templates',
  'edit:whatsapp-bot:templates',
  'view:whatsapp-bot:conversations',
  'edit:whatsapp-bot:conversations',
  'view:whatsapp-bot:unanswered',
  'edit:whatsapp-bot:unanswered',
  'view:whatsapp-bot:analytics',
];

const GROUP_GRANTS: Record<string, string[]> = {
  SUPER_DUPER_ADMIN: NEW_PERMISSIONS,
};

export class AddWhatsAppBotPermissions1892000000009 implements MigrationInterface {
  name = 'AddWhatsAppBotPermissions1892000000009';

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
