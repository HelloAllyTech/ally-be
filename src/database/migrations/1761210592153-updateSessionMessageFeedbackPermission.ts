import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSessionMessageFeedbackPermission1761210592153 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Assign edit:scenario-session:feedback permission to LEARNER
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name = 'LEARNER' 
        AND p.name = 'edit:scenario-session:feedback'
        AND NOT EXISTS (
          SELECT 1 FROM "group_permissions" gp 
          WHERE gp."groupId" = g.id AND gp."permissionId" = p.id
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove edit:scenario-session:feedback permission from LEARNER
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "groupId" = (SELECT id FROM "groups" WHERE name = 'LEARNER')
        AND "permissionId" = (SELECT id FROM "permissions" WHERE name = 'edit:scenario-session:feedback')
    `);
  }
}
