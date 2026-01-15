import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReviewAccessPermissions1768306778341 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add review permissions
    await queryRunner.query(`
          INSERT INTO "permissions" ("name") VALUES 
            ('reviewer:access'),
            ('learner:access')
        `);

    // Assign permission to REVIEWER
    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT g.id, p.id
            FROM "groups" g, "permissions" p
            WHERE g.name = 'REVIEWER'
            AND p.name IN ('reviewer:access')
          `);

    // Assign permission to LEARNER
    await queryRunner.query(`
          INSERT INTO "group_permissions" ("groupId", "permissionId")
          SELECT g.id, p.id
          FROM "groups" g, "permissions" p
          WHERE g.name = 'LEARNER'
          AND p.name IN ('learner:access')
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove group permissions
    await queryRunner.query(`
          DELETE FROM "group_permissions" 
          WHERE "permissionId" IN (
            SELECT id FROM "permissions" 
            WHERE name IN ('reviewer:access', 'learner:access')
          )
        `);

    // Remove permissions
    await queryRunner.query(`
          DELETE FROM "permissions" 
          WHERE name IN ('reviewer:access', 'learner:access')
        `);
  }
}
