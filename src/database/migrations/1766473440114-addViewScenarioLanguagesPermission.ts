import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewScenarioLanguagesPermission1766473440114 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES ('view:scenario-languages')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g, "permissions" p
      WHERE g."name" IN ('SUPER_ADMIN', 'LEARNER') AND p."name" = 'view:scenario-languages'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" WHERE "name" = 'view:scenario-languages'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" WHERE "name" = 'view:scenario-languages'
    `);
  }
}
