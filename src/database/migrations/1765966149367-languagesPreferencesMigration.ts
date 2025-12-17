import { MigrationInterface, QueryRunner } from 'typeorm';

export class LanguagesPreferencesMigration1765966149367
  implements MigrationInterface
{
  name = 'LanguagesPreferencesMigration1765966149367';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert languages data
    await queryRunner.query(`
       INSERT INTO "languages" ("value", "label", "active", "translationCode") VALUES
          ('en-IN', 'English (India)', true, 'en'),
          ('hi-IN', 'Hindi (India)', true, 'hi'),
          ('bn-IN', 'Bengali (India)', true, 'bn'),
          ('te-IN', 'Telugu (India)', true, 'te'),
          ('mr-IN', 'Marathi (India)', true, 'mr'),
          ('ta-IN', 'Tamil (India)', true, 'ta'),
          ('gu-IN', 'Gujarati (India)', true, 'gu'),
          ('kn-IN', 'Kannada (India)', true, 'kn'),
          ('ml-IN', 'Malayalam (India)', true, 'ml'),
          ('pa-IN', 'Punjabi (India)', true, 'pa'),
          ('or-IN', 'Odia (India)', true, 'or');
    `);

    // Update existing scenario_voices with languageId 1 as we have only one language for now
    await queryRunner.query(`
      UPDATE "scenario_voices" sv
      SET "languageId" = 1
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("name") 
      VALUES 
        ('edit:user:preferences'),
        ('view:user:preferences')
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("name") 
      VALUES ('view:admin:scenario-voice-languages')
    `);

    // Assign permissions to LEARNER group
    await queryRunner.query(`
      INSERT INTO "group_permissions" ("groupId", "permissionId")
      SELECT g."id", p."id"
      FROM "groups" g
      CROSS JOIN "permissions" p
      WHERE g."name" = 'LEARNER' 
      AND p."name" IN ('edit:user:preferences', 'view:user:preferences')
      AND NOT EXISTS (
        SELECT 1 FROM "group_permissions" gp 
        WHERE gp."groupId" = g."id" 
        AND gp."permissionId" = p."id"
      )
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
    // Remove permissions from all groups
    await queryRunner.query(`
      DELETE FROM "group_permissions"
      WHERE "permissionId" IN (
        SELECT "id" FROM "permissions" 
        WHERE "name" IN ('edit:user:preferences', 'view:user:preferences')
      )
    `);

    // Remove the permissions
    await queryRunner.query(`
      DELETE FROM "permissions" 
      WHERE "name" IN ('edit:user:preferences', 'view:user:preferences')
    `);

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
