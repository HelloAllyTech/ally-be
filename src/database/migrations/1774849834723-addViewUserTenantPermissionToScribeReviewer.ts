import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewUserTenantPermissionToScribeReviewer1774849834723 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          INSERT INTO "group_permissions" ("groupId", "permissionId")
          SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:user:tenant')
          FROM "groups"
          WHERE "name" = 'SCRIBE_REVIEWER'
        `);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          DELETE FROM "group_permissions"
          WHERE "groupId" = (SELECT "id" FROM "groups" WHERE "name" = 'SCRIBE_REVIEWER')
          AND "permissionId" = (SELECT "id" FROM "permissions" WHERE "name" = 'view:user:tenant')
        `);
  }
}
