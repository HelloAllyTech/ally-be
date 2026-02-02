import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveBadgesPermissionFromCounselor1770032326253 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DELETE FROM "group_permissions"
            WHERE "groupId" = (
              SELECT id FROM "groups" WHERE "name" = 'COUNSELOR'
            )
            AND "permissionId" IN (
              SELECT id FROM "permissions"
              WHERE "name" IN ('view:user:badges', 'edit:user:badges')
            )
          `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT g."id", p."id"
            FROM "groups" g
            CROSS JOIN "permissions" p
            WHERE g."name" = 'COUNSELOR'
            AND p."name" IN ('view:user:badges', 'edit:user:badges')
          `);
  }
}
