import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opens the Character Library (list + interview agent + create) to a tenant's
 * own ADMINs, scoped to that tenant.
 *
 * Two halves:
 *
 * 1. `tenant_id` on `scenario_characters` and `character_interview_sessions`.
 *    NULL means Ally-owned/global — every row that exists today. A tenant
 *    admin only ever reads and writes rows stamped with their own tenant, so
 *    one org's characters are invisible to another; platform admins see all
 *    rows (global + every tenant's). Nullable and un-backfilled on purpose:
 *    the existing curated library must stay global.
 *
 * 2. VIEW + CREATE scenario-character permissions on the ADMIN group.
 *    Deliberately NOT edit/delete — a tenant admin creates a character and can
 *    read it back, but cannot change or remove one once saved. Holding the
 *    permission is necessary but not sufficient: the routes also require the
 *    org-level CHARACTER_LIBRARY_ENABLED preference, so nothing switches on
 *    for any tenant until a platform admin flips it per org.
 *
 * After running this, flush the Redis permission cache (the prefixed
 * `*group:permissions:*` / `*user:groups:*` keys, 30-min TTL) or tenant admins
 * keep 403-ing until it expires.
 */
const ADMIN_CHARACTER_PERMISSIONS = [
  'view:scenario-character',
  'create:scenario-character',
];

export class AddTenantScopedCharacterLibrary1905000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" ADD COLUMN IF NOT EXISTS "tenant_id" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_scenario_characters_tenant_id" ON "scenario_characters" ("tenant_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "character_interview_sessions" ADD COLUMN IF NOT EXISTS "tenant_id" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_character_interview_sessions_tenant_id" ON "character_interview_sessions" ("tenant_id")`,
    );

    // The permission rows already exist (created with the character library),
    // but stay self-contained and idempotent.
    for (const name of ADMIN_CHARACTER_PERMISSIONS) {
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

    for (const name of ADMIN_CHARACTER_PERMISSIONS) {
      await queryRunner.query(
        `
        INSERT INTO "group_permissions" ("groupId", "permissionId")
        SELECT g."id", p."id"
        FROM "groups" g
        JOIN "permissions" p ON p."name" = $1
        WHERE g."name" = 'ADMIN'
        ON CONFLICT DO NOTHING
        `,
        [name],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      DELETE FROM "group_permissions"
      WHERE "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'ADMIN')
        AND "permissionId" IN (
          SELECT "id" FROM "permissions" WHERE "name" = ANY($1)
        )
      `,
      [ADMIN_CHARACTER_PERMISSIONS],
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_character_interview_sessions_tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "character_interview_sessions" DROP COLUMN IF EXISTS "tenant_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_scenario_characters_tenant_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_characters" DROP COLUMN IF EXISTS "tenant_id"`,
    );
  }
}
