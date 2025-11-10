import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAtColumnToScenarioAndScenarioEvents1761287109112
  implements MigrationInterface
{
  name = 'AddDeletedAtColumnToScenarioAndScenarioEvents1761287109112';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "session_events" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenarios" ADD "deletedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_events" ADD "deletedAt" TIMESTAMP`,
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
           VALUES
             ('view:admin:scenarios'),
             ('view:admin:scenario'),
             ('delete:admin:scenario')`,
    );

    await queryRunner.query(
      `WITH "newPermissionIds" AS (
             SELECT 
               id AS "permissionIds"
             FROM "permissions"
             WHERE name IN ('view:admin:scenarios', 'view:admin:scenario', 'delete:admin:scenario')
           )
           INSERT INTO "group_permissions" ("groupId", "permissionId")
           SELECT id, "newPermissionIds"."permissionIds"
           FROM "groups", "newPermissionIds"
           WHERE name = '${UserRole.SUPER_ADMIN}'
             AND "newPermissionIds"."permissionIds" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "group_permissions"
           WHERE "permissionId" IN (
             SELECT id
             FROM "permissions"
             WHERE name IN ('view:admin:scenarios', 'view:admin:scenario', 'delete:admin:scenario')
           )
           AND "groupId" = (
             SELECT id
             FROM "groups"
             WHERE name = '${UserRole.SUPER_ADMIN}'
           )`,
    );

    await queryRunner.query(
      `DELETE FROM "permissions"
           WHERE name IN ('view:admin:scenarios', 'view:admin:scenario', 'delete:admin:scenario')`,
    );

    await queryRunner.query(
      `ALTER TABLE "scenario_events" DROP COLUMN "deletedAt"`,
    );
    await queryRunner.query(`ALTER TABLE "scenarios" DROP COLUMN "deletedAt"`);
    await queryRunner.query(
      `ALTER TABLE "session_events" DROP COLUMN "deletedAt"`,
    );
  }
}
