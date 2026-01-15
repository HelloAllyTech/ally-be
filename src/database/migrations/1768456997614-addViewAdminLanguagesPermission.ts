import { MigrationInterface, QueryRunner } from 'typeorm';

export class addViewAdminLanguagesPermission1768456997614 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES ('view:admin:languages')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g, "permissions" p
      WHERE g."name" = 'SUPER_ADMIN' AND p."name" = 'view:admin:languages'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "name" = 'view:admin:languages'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "name" = 'view:admin:languages'
    `);
  }
}
