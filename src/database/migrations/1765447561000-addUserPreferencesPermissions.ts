import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPreferencesPermissions1765447530000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new permissions
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") 
      VALUES 
        ('edit:user:preferences'),
        ('view:user:preferences')
      ON CONFLICT ("name") DO NOTHING
    `);

    // Assign permissions to LEARNER group
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      CROSS JOIN "permissions" p
      WHERE g."name" = 'LEARNER' 
      AND p."name" IN ('edit:user:preferences', 'view:user:preferences')
      AND NOT EXISTS (
        SELECT 1 FROM "group_permissions" gp 
        WHERE gp."groupId" = g."id" 
        AND gp."permissionId" = p."id"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permissions from all groups
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" IN ('edit:user:preferences', 'view:user:preferences')
      )
    `);

    // Remove the permissions
    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" IN ('edit:user:preferences', 'view:user:preferences')
    `);
  }
}
