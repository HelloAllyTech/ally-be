import { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_REVIEW_PERMISSIONS = [
  'view:review',
  'edit:review',
  'view:reviews',
  'view:review-threads',
  'edit:review-thread',
  'reviewer:access',
];

export class RemoveLegacyReviewPermissions1774343876806 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions"
        WHERE "name" IN (${LEGACY_REVIEW_PERMISSIONS.map((p) => `'${p}'`).join(', ')})
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN (${LEGACY_REVIEW_PERMISSIONS.map((p) => `'${p}'`).join(', ')})
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES ${LEGACY_REVIEW_PERMISSIONS.map((p) => `('${p}')`).join(', ')}
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      CROSS JOIN "permissions" p
      WHERE g."name" = 'LEARNER'
      AND p."name" IN ('view:review', 'edit:review', 'view:review-threads', 'edit:review-thread')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      CROSS JOIN "permissions" p
      WHERE g."name" = 'SIMULATION_REVIEWER'
      AND p."name" IN ('view:review', 'view:reviews', 'view:review-threads', 'edit:review-thread', 'reviewer:access')
    `);
  }
}
