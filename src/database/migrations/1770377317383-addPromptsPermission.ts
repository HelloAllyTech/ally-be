import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPromptsPermission1770377317383 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES
        ('view:admin:prompts'),
        ('edit:admin:prompts')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:admin:prompts', 'edit:admin:prompts')
      WHERE g."name" = 'SUPER_ADMIN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN ('view:admin:prompts', 'edit:admin:prompts')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('view:admin:prompts', 'edit:admin:prompts')
    `);
  }
}
