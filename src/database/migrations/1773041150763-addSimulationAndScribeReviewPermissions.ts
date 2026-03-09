import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSimulationAndScribeReviewPermissions1773041150763 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES
        ('view:simulation-review'),
        ('edit:simulation-review'),
        ('view:simulation-reviews'),
        ('view:simulation-review-threads'),
        ('edit:simulation-review-thread'),
        ('simulation-reviewer:access'),
        ('view:scribe-review'),
        ('edit:scribe-review'),
        ('view:scribe-reviews'),
        ('view:scribe-review-threads'),
        ('edit:scribe-review-thread'),
        ('scribe-reviewer:access')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:simulation-review', 'view:simulation-review-threads', 'edit:simulation-review-thread')
      WHERE g."name" IN ('LEARNER', 'SIMULATION_REVIEWER')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('edit:simulation-review')
      WHERE g."name" = 'LEARNER'
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:simulation-reviews', 'simulation-reviewer:access')
      WHERE g."name" = 'SIMULATION_REVIEWER'
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:scribe-review', 'view:scribe-review-threads', 'edit:scribe-review-thread')
      WHERE g."name" IN ('ADMIN', 'COUNSELOR', 'SCRIBE_REVIEWER')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('edit:scribe-review')
      WHERE g."name" IN ('ADMIN', 'COUNSELOR')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('view:scribe-reviews', 'scribe-reviewer:access')
      WHERE g."name" = 'SCRIBE_REVIEWER'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN ('view:simulation-review', 'edit:simulation-review', 'view:simulation-reviews', 'view:simulation-review-threads', 'edit:simulation-review-thread', 'simulation-reviewer:access', 'view:scribe-review', 'edit:scribe-review', 'view:scribe-reviews', 'view:scribe-review-threads', 'edit:scribe-review-thread', 'scribe-reviewer:access')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('view:simulation-review', 'edit:simulation-review', 'view:simulation-reviews', 'view:simulation-review-threads', 'edit:simulation-review-thread', 'simulation-reviewer:access', 'view:scribe-review', 'edit:scribe-review', 'view:scribe-reviews', 'view:scribe-review-threads', 'edit:scribe-review-thread', 'scribe-reviewer:access')
    `);
  }
}
