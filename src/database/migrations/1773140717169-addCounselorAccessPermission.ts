import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCounselorAccessPermission1773140717169 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name")
      VALUES
        ('counselor:access')
    `);

    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      JOIN "permissions" p ON p."name" IN ('counselor:access')
      WHERE g."name" = 'COUNSELOR'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id"
        FROM "permissions"
        WHERE "name" IN ('counselor:access')
      )
    `);

    await queryRunner.query(`
      DELETE FROM "permissions"
      WHERE "name" IN ('counselor:access')
    `);
  }
}
