import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManageMultiTenantPermissions1773298786549 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES
        ('view:multi-tenant-admins'),
        ('edit:multi-tenant-admins')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:multi-tenant-admins', 'edit:multi-tenant-admins')
      WHERE g."name" = 'SUPER_ADMIN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN ('view:multi-tenant-admins', 'edit:multi-tenant-admins')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('view:multi-tenant-admins', 'edit:multi-tenant-admins')
    `);
  }
}
