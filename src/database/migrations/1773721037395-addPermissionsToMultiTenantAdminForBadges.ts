import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class addPermissionsToMultiTenantAdminForBadges1773719729633 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
           INSERT INTO "group_permissions" ("groupId", "permissionId")
           SELECT g."id", p."id"
           FROM "groups" g
           JOIN "permissions" p ON p."name" IN ('view:admin:badges-for-setting','edit:admin:badges','edit:scenario-tenant', 'view:settings:summary-fields', 'system:access', 'delete:scenario-tenant','edit:settings:summary-fields')
           WHERE g."name" =  '${UserRole.MULTI_TENANT_ADMIN}'
         `);

    await queryRunner.query(`
           INSERT INTO "group_permissions" ("groupId", "permissionId")
           SELECT g."id", p."id"
           FROM "groups" g
           JOIN "permissions" p ON p."name" IN ('view:admin:badges-for-setting')
           WHERE g."name" =  '${UserRole.SUPER_ADMIN}'
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
            'view:admin:badges-for-setting','edit:admin:badges','edit:scenario-tenant', 'view:settings:summary-fields', 'system:access', 'delete:scenario-tenant','edit:settings:summary-fields'
           )
         )
       `);

    await queryRunner.query(`
         DELETE FROM "group_permissions"
         WHERE "groupId" IN (
           SELECT "id"
           FROM "groups"
           WHERE "name" = '${UserRole.SUPER_ADMIN}'
         )
         AND "permissionId" IN (
           SELECT "id"
           FROM "permissions"
           WHERE "name" IN (
            'view:admin:badges-for-setting'
           )
         )
       `);
  }
}
