import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionArchiveCallLogs1770147528530 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") VALUES ('archive:call-log')
    `);
    await queryRunner.query(`
          INSERT INTO "group_permissions" ("groupId", "permissionId")
          SELECT g.id, p.id
          FROM "groups" g, "permissions" p
          WHERE g.name = 'COUNSELOR'
          AND p.name = 'archive:call-log'
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
          DELETE FROM "group_permissions" 
          WHERE "groupId" = (SELECT id FROM "groups" WHERE name = 'COUNSELOR')
            AND "permissionId" = (SELECT id FROM "permissions" WHERE name = 'archive:call-log')
        `);
    await queryRunner.query(`
          DELETE FROM "permissions" WHERE name = 'archive:call-log'
        `);
  }
}
