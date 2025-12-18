import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLanguagePermission1766062081921 implements MigrationInterface {
  name = 'AddLanguagePermission1766062081921';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES ('edit:admin:admin')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g, "permissions" p
      WHERE g."name" = 'SUPER_ADMIN' AND p."name" = 'edit:admin:admin'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "name" = 'edit:admin:admin'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "name" = 'edit:admin:admin'
    `);
  }
}
