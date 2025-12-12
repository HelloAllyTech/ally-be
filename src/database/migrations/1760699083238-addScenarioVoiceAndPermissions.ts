import { UserRole } from 'src/common/constants/user.constants';
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScenarioVoiceAndPermissions1760699083238
  implements MigrationInterface
{
  name = 'AddScenarioVoiceAndPermissions1760699083238';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "scenario_voices" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "provider" character varying NOT NULL, "config" jsonb, "languageId" integer NOT NULL, CONSTRAINT "PK_d5a350cba54e9486908f9c82020" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
         VALUES
           ('view:session-events'),
           ('delete:session-events'),
           ('view:scenario-voices'),
           ('edit:scenario-voice')`,
    );

    await queryRunner.query(
      `WITH "newPermissionIds" AS (
           SELECT 
             id AS "permissionIds"
           FROM "permissions"
           WHERE name IN ('view:session-events', 'delete:session-events', 'view:scenario-voices', 'edit:scenario-voice')
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
           WHERE name IN ('view:session-events', 'delete:session-events', 'view:scenario-voices', 'edit:scenario-voice')
         )
         AND "groupId" = (
           SELECT id
           FROM "groups"
           WHERE name = '${UserRole.SUPER_ADMIN}'
         )`,
    );

    await queryRunner.query(
      `DELETE FROM "permissions"
         WHERE name IN ('view:session-events', 'delete:session-events', 'view:scenario-voices', 'edit:scenario-voice')`,
    );

    await queryRunner.query(`DROP TABLE "scenario_voices"`);
  }
}
