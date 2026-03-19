import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMultiTenantAdminPermissionsForScenarioCoverImageLibrary1773929651271 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
       INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT g."id", p."id"
       FROM "groups" g
       JOIN "permissions" p ON p."name" IN ('view:scenario-cover-image-library','delete:admin:scenario')
       WHERE g."name" =  '${UserRole.MULTI_TENANT_ADMIN}'
     `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
     DELETE FROM "group_permissions"
     WHERE "groupId" IN (
       SELECT "id"
       FROM "groups"
       WHERE "name" = '${UserRole.MULTI_TENANT_ADMIN}'
     )
     AND "permissionId" IN (
       SELECT "id"
       FROM "permissions"
       WHERE "name" IN (
        'view:scenario-cover-image-library','delete:admin:scenario'
       )
     )
   `);
  }
}
