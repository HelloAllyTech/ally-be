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

    await queryRunner.query(
      `ALTER TABLE "scenario_voices" ADD "languageId" integer`,
    );

    await queryRunner.query(`
      UPDATE "scenario_voices"
      SET "languageId" = (
        SELECT id
        FROM "languages"
        WHERE label = 'English (India)'
        LIMIT 1
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "scenario_voices"
      ALTER COLUMN "languageId" SET NOT NULL
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
    await queryRunner.query(`
    DELETE FROM "group_permissions"
    WHERE "permissionId" IN (
      SELECT "id" FROM "permissions"
      WHERE "name" IN (
        'edit:user:preferences',
        'view:user:preferences',
        'view:admin:scenario-voice-languages'
      )
    )
  `);

    await queryRunner.query(`
    DELETE FROM "permissions"
    WHERE "name" IN (
      'edit:user:preferences',
      'view:user:preferences',
      'view:admin:scenario-voice-languages'
    )
  `);

    await queryRunner.query(`
    ALTER TABLE "scenario_voices"
    DROP COLUMN "languageId"
  `);
  }
}
