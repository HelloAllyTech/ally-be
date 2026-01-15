import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveCommunityPermission1766470280453 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" IN ('view:navbar:community', 'view:community')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" IN ('view:navbar:community', 'view:community')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES 
        ('view:navbar:community'),
        ('view:community')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId") 
      SELECT g."id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:navbar:community')
      FROM "groups" g 
      WHERE g."name" IN ('ADMIN', 'COUNSELOR')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId") 
      SELECT g."id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:community')
      FROM "groups" g 
      WHERE g."name" IN ('ADMIN', 'COUNSELOR')
    `);
  }
}
