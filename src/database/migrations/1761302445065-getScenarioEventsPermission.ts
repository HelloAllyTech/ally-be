import { MigrationInterface, QueryRunner } from 'typeorm';

export class GetScenarioEventsPermission1761302445065
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
             VALUES ('view:scenario-events')`,
    );

    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
             SELECT "id", (SELECT "id" FROM "permissions" WHERE "name" = 'view:scenario-events')
             FROM "groups"
             WHERE "name" = 'SUPER_ADMIN'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions"
             WHERE "permissionId" = (SELECT "id" FROM "permissions" WHERE "name" = 'view:scenario-events')`,
    );

    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "name" = 'view:scenario-events'`,
    );
  }
}
