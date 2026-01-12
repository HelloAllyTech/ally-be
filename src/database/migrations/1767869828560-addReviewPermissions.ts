import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewPermissions1767869828560 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create REVIEWER role
    await queryRunner.query(`
      INSERT INTO "groups" ("name") 
      SELECT 'REVIEWER' 
      WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE "name" = 'REVIEWER')
    `);

    // Add review permissions
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES 
        ('view:review'),
        ('edit:review'),
        ('view:reviews'),
        ('view:review-threads'),
        ('edit:review-thread')
    `);

    // Assign permissions to LEARNER
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name = 'LEARNER'
      AND p.name IN ('view:review', 'edit:review', 'view:review-threads', 'edit:review-thread')
    `);

    // Assign permissions to REVIEWER
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g.id, p.id
      FROM "groups" g, "permissions" p
      WHERE g.name = 'REVIEWER'
      AND p.name IN ('view:reviews', 'view:review-threads', 'edit:review-thread')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove group permissions
    await queryRunner.query(`
      DELETE FROM "group_permissions" 
      WHERE "permissionId" IN (
        SELECT id FROM "permissions" 
        WHERE name IN ('view:review', 'edit:review', 'view:reviews', 'view:review-threads', 'edit:review-thread')
      )
    `);

    // Remove permissions
    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE name IN ('view:review', 'edit:review', 'view:reviews', 'view:review-threads', 'edit:review-thread')
    `);

    // Remove REVIEWER role
    await queryRunner.query(`DELETE FROM "groups" WHERE "name" = 'REVIEWER'`);
  }
}
