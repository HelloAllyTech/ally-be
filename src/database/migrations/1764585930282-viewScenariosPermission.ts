import { MigrationInterface, QueryRunner } from 'typeorm';

export class ViewScenariosPermission1764585930282
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES ('view:scenarios')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g, "permissions" p
      WHERE g."name" = 'LEARNER' AND p."name" = 'view:scenarios'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "name" = 'view:scenarios'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "name" = 'view:scenarios'
    `);
  }
}
