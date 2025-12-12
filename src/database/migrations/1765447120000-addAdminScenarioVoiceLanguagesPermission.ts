import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAdminScenarioVoiceLanguagesPermission1765447120000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new permission
    await queryRunner.query(`
      INSERT INTO "permissions" ("name") 
      VALUES ('view:admin:scenario-voice-languages')
      ON CONFLICT ("name") DO NOTHING
    `);

    // Assign the permission to the SUPER_ADMIN group
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g, "permissions" p
      WHERE g."name" = 'SUPER_ADMIN' 
      AND p."name" = 'view:admin:scenario-voice-languages'
      AND NOT EXISTS (
        SELECT 1 FROM "group_permissions" gp 
        WHERE gp."groupId" = g."id" 
        AND gp."permissionId" = p."id"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the permission from the SUPER_ADMIN group
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" = 'view:admin:scenario-voice-languages'
      )
    `);

    // Remove the permission
    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" = 'view:admin:scenario-voice-languages'
    `);
  }
}
