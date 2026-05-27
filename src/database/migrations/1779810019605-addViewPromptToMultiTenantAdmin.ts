import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewPromptToMultiTenantAdmin1779810019605 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" = 'view:admin:prompts'
      WHERE g."name" = 'MULTI_TENANT_ADMIN'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'MULTI_TENANT_ADMIN')
        AND "permissionId" = (SELECT "id" FROM "permissions" WHERE "name" = 'view:admin:prompts')
    `);
  }
}
