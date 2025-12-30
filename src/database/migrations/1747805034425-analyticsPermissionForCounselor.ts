import { MigrationInterface, QueryRunner } from 'typeorm';

export class AnalyticsPermissionForCounselor1747805034425
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          WITH group_details AS (
            SELECT id 
            FROM groups 
            WHERE name = 'COUNSELOR'
          )
          INSERT INTO group_permissions ("groupId", "permissionId")
          SELECT 
            group_details.id,
            permissions.id 
          FROM group_details, permissions 
          WHERE permissions.name = 'view:navbar:analytics'
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          WITH group_details AS (
            SELECT id 
            FROM groups 
            WHERE name = 'COUNSELOR'
          )
          DELETE FROM group_permissions 
          WHERE "groupId" IN (SELECT id FROM group_details)
          AND "permissionId" IN (
            SELECT id FROM permissions 
            WHERE name = 'view:navbar:analytics')
        `);
  }
}
