import { MigrationInterface, QueryRunner } from 'typeorm';

// Grants the user-preferences permissions to the SUPER_ADMIN group so super
// admins can read/write their own preferences (e.g. the admin sidebar order).
// These permissions previously existed but were only granted to LEARNER, so a
// SUPER_ADMIN hitting the preferences endpoints got a 403.
const PREFERENCE_PERMISSIONS = [
  'edit:user:preferences',
  'view:user:preferences',
];

export class GrantUserPreferencesToSuperAdmin1781500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure the permission rows exist (idempotent; they should already from
    // the language-preferences migration, but stay self-contained).
    for (const name of PREFERENCE_PERMISSIONS) {
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

    // Grant each permission to the SUPER_ADMIN group (idempotent).
    for (const name of PREFERENCE_PERMISSIONS) {
      await queryRunner.query(
        `
        INSERT INTO "group_permissions" ("groupId", "permissionId")
        SELECT g."id", p."id"
        FROM "groups" g
        JOIN "permissions" p ON p."name" = $1
        WHERE g."name" = 'SUPER_ADMIN'
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
      WHERE "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'SUPER_ADMIN')
        AND "permissionId" IN (
          SELECT "id" FROM "permissions" WHERE "name" = ANY($1)
        )
      `,
      [PREFERENCE_PERMISSIONS],
    );
  }
}
