import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewScenarioPermissionToReviewer1768373028557 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name = 'REVIEWER'
      AND p.name = 'view:review'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "groupId" = (SELECT id FROM "groups" WHERE name = 'REVIEWER')
        AND "permissionId" = (SELECT id FROM "permissions" WHERE name = 'view:review')
    `);
  }
}
