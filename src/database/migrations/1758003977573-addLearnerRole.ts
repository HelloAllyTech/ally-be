import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLearnerRole1758003977573 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Delete all group-permission associations for 'view:navbar:learn' permission
    await queryRunner.query(`
            DELETE FROM group_permissions 
            WHERE "permissionId" = (
                SELECT id FROM permissions WHERE name = 'view:navbar:learn'
            )
        `);

    // Add new scenario session permissions
    await queryRunner.query(`
            INSERT INTO permissions ("name") VALUES 
            ('view:scenario-session'),
            ('view:admin:scenario-session'),
            ('view:scenario-session:summary')
        `);

    // Create LEARNER role
    await queryRunner.query(`
            INSERT INTO groups ("name") VALUES ('LEARNER')
        `);

    // Assign permissions to LEARNER role
    await queryRunner.query(`
            WITH group_details AS (
                SELECT id 
                FROM groups 
                WHERE name = 'LEARNER'
            )
            INSERT INTO group_permissions ("groupId", "permissionId")
            SELECT 
                group_details.id,
                permissions.id 
            FROM group_details, permissions 
            WHERE permissions.name IN (
                'view:scenario-session',
                'view:admin:scenario-session',
                'view:scenario-session:summary'
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove LEARNER role and its permissions
    await queryRunner.query(`
            DELETE FROM group_permissions 
            WHERE "groupId" = (
                SELECT id FROM groups WHERE name = 'LEARNER'
            )
        `);

    await queryRunner.query(`
            DELETE FROM groups WHERE name = 'LEARNER'
        `);

    // Remove the new scenario session permissions
    await queryRunner.query(`
            DELETE FROM permissions 
            WHERE name IN (
                'view:scenario-session',
                'view:admin:scenario-session',
                'view:scenario-session:summary'
            )
        `);

    // Restore 'view:navbar:learn' permission to groups
    await queryRunner.query(`
            WITH group_details AS (
                SELECT id 
                FROM groups 
                WHERE name = 'ADMIN'
            )
            INSERT INTO group_permissions ("groupId", "permissionId")
            SELECT 
                group_details.id,
                permissions.id 
            FROM group_details, permissions 
            WHERE permissions.name = 'view:navbar:learn'
        `);
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
            WHERE permissions.name = 'view:navbar:learn'
        `);
    await queryRunner.query(`
            WITH group_details AS (
                SELECT id 
                FROM groups 
                WHERE name = 'SUPER_ADMIN'
            )
            INSERT INTO group_permissions ("groupId", "permissionId")
            SELECT 
                group_details.id,
                permissions.id 
            FROM group_details, permissions 
            WHERE permissions.name = 'view:navbar:learn'
        `);
  }
}
