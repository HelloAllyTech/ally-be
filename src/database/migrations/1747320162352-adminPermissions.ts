import { MigrationInterface, QueryRunner } from 'typeorm';

export class AdminPermissions1747320162352 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH group_details AS (
        SELECT id 
        FROM groups 
        WHERE name IN ('ADMIN')
      )
      INSERT INTO group_permissions ("groupId", "permissionId")
      SELECT 
        group_details.id,
        permissions.id 
      FROM group_details, permissions 
      WHERE permissions.name IN (
        'view:navbar:calls',
        'view:navbar:calendar',
        'view:navbar:analytics',
        'view:navbar:learn',
        'view:navbar:stress-buster',
        'view:navbar:settings',
        'edit:summary'
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH group_details AS (
        SELECT id 
        FROM groups 
        WHERE name IN ('ADMIN')
      )
      DELETE FROM group_permissions 
      WHERE "groupId" IN (SELECT id FROM group_details)
      AND "permissionId" IN (
        SELECT id FROM permissions 
        WHERE name IN (
          'view:navbar:calls',
          'view:navbar:calendar',
          'view:navbar:analytics',
          'view:navbar:learn',
          'view:navbar:stress-buster',
          'view:navbar:settings',
          'edit:summary'
        )
      )
    `);
  }
}
