import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioTenantPermissions1763705105131
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES
        ('edit:scenario-path-tenant'),
        ('delete:scenario-path-tenant'),
        ('edit:scenario-tenant'),
        ('delete:scenario-tenant')
    `);

    // Assign permissions to SUPER_ADMIN group with explicit aliasing of ids
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g, "permissions" p
      WHERE g."name" = 'SUPER_ADMIN' AND p."name" IN (
        'edit:scenario-path-tenant',
        'delete:scenario-path-tenant',
        'edit:scenario-tenant',
        'delete:scenario-tenant'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove group permissions for these permissions
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions"
        WHERE "name" IN (
          'edit:scenario-path-tenant',
          'delete:scenario-path-tenant',
          'edit:scenario-tenant',
          'delete:scenario-tenant'
        )
      )
    `);

    // Remove the permissions themselves
    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN (
        'edit:scenario-path-tenant',
        'delete:scenario-path-tenant',
        'edit:scenario-tenant',
        'delete:scenario-tenant'
      )
    `);
  }
}
