import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNavbarSearchAndCommunityPermissions1758093544660
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Assign view:admin:scenario-session permission to admin and remove it from learner
    await queryRunner.query(`
        DELETE FROM "group_permissions" WHERE "permissionId" = (
            SELECT id FROM "permissions" WHERE name IN ('view:admin:scenario-session')
        ) AND "groupId" = (
            SELECT id FROM "groups" WHERE name = 'LEARNER'
        )
    `);

    await queryRunner.query(`
        INSERT INTO "group_permissions" ("groupId", "permissionId")
        SELECT id, (SELECT id FROM "permissions" WHERE name = 'view:admin:scenario-session') FROM "groups" WHERE name = 'ADMIN'
    `);

    // Add permissions for searxh and community nav bar
    await queryRunner.query(`
            INSERT INTO "permissions" ("name") VALUES 
            ('view:navbar:search'),
            ('view:navbar:community')
        `);

    // Assign both view:navbar:search and view:navbar:community permissions to both counselor and admin
    await queryRunner.query(`
        WITH group_details AS (
            SELECT id 
            FROM "groups" 
            WHERE name IN ('COUNSELOR', 'ADMIN')
        )
        INSERT INTO group_permissions ("groupId", "permissionId")
        SELECT 
            group_details.id,
            permissions.id 
        FROM group_details, "permissions" 
        WHERE permissions.name IN (
            'view:navbar:search',
            'view:navbar:community'
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove permissions for search and community nav bar
    await queryRunner.query(`
        DELETE FROM "group_permissions" WHERE "permissionId" IN (
            SELECT id FROM "permissions" WHERE name IN ('view:navbar:search', 'view:navbar:community')
        ) AND "groupId" IN (
            SELECT id FROM "groups" WHERE name IN ('COUNSELOR', 'ADMIN')
        )
    `);

    // Remove permissions for search and community nav bar
    await queryRunner.query(`
            DELETE FROM "permissions" WHERE name IN ('view:navbar:search', 'view:navbar:community');
        `);

    await queryRunner.query(`
        DELETE FROM "group_permissions" WHERE "permissionId" = (
            SELECT id FROM "permissions" WHERE name IN ('view:admin:scenario-session')
        ) AND "groupId" = (
            SELECT id FROM "groups" WHERE name = 'ADMIN'
        )
    `);

    await queryRunner.query(`INSERT INTO "group_permissions" ("groupId", "permissionId")
        SELECT id, (SELECT id FROM "permissions" WHERE name = 'view:admin:scenario-session') FROM "groups" WHERE name = 'LEARNER'
    `);
  }
}
