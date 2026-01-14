import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBadgePermissions1768377710800 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            INSERT INTO "permissions" ("name") VALUES
            ('view:admin:badges'),
            ('edit:admin:badges'),
            ('view:user:badges')
          `);

    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT g."id", p."id"
            FROM "groups" g
            CROSS JOIN "permissions" p
            WHERE g."name" = 'SUPER_ADMIN'
            AND p."name" IN ('view:admin:badges', 'edit:admin:badges')
          `);
    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:user:badges')
            FROM "groups"
            WHERE "name" = 'LEARNER'
          `);
    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:user:badges')
            FROM "groups"
            WHERE "name" = 'REVIEWER'
          `);
    await queryRunner.query(`
            INSERT INTO "group_permissions" ("groupId", "permissionId")
            SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:user:badges')
            FROM "groups"
            WHERE "name" = 'COUNSELOR'
          `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
        DELETE FROM "group_permissions"
        WHERE "permissionId" IN (
          SELECT "id" FROM "permissions"
          WHERE "name" IN ('view:admin:badges', 'edit:admin:badges', 'view:user:badges')
        )
      `);

    await queryRunner.query(`
        DELETE FROM "permissions"
        WHERE "name" IN ('view:admin:badges', 'edit:admin:badges', 'view:user:badges')
      `);
  }
}
