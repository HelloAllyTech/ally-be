import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewScenarioPermission1767865219353
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES
        ('view:scenario')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:scenario')
      FROM "groups"
      WHERE "name" = 'LEARNER'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions"
        WHERE "name" = 'view:scenario'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" = 'view:scenario'
    `);
  }
}
