import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewTenantsPermission1760772282773 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert permissions
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES 
        ('view:tenants')
    `);

    // Insert group permissions for SUPER_ADMIN group
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId") 
      SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:tenants')
      FROM "groups" 
      WHERE "name" = 'SUPER_ADMIN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove group permissions first (due to foreign key constraints)
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" = 'view:tenants'
      )
    `);

    // Remove permissions
    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" = 'view:tenants'
    `);
  }
}
