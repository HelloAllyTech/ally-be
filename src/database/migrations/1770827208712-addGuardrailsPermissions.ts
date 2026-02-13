import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuardrailsPermissions1770827208712 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES
        ('view:admin:guardrails'),
        ('edit:admin:guardrails')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:admin:guardrails', 'edit:admin:guardrails')
      WHERE g."name" = 'SUPER_ADMIN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN ('view:admin:guardrails', 'edit:admin:guardrails')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('view:admin:guardrails', 'edit:admin:guardrails')
    `);
  }
}
