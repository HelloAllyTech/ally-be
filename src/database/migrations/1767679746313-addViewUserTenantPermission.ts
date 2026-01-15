import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewUserTenantPermission1767679746313 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES 
        ('view:user:tenant')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId") 
      SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:user:tenant')
      FROM "groups" 
      WHERE "name" IN ('ADMIN', 'LEARNER', 'COUNSELOR')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" = 'view:user:tenant'
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" = 'view:user:tenant'
    `);
  }
}
