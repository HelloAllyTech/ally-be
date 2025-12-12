import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLanguagesTable1765343876000 implements MigrationInterface {
  name = 'CreateLanguagesTable1765343876000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create languages table
    await queryRunner.query(`
      CREATE TABLE "languages" (
        "id" SERIAL NOT NULL,
        "value" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "translationCode" TEXT NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_languages_id" PRIMARY KEY ("id")
      )
    `);

    // Create index on id
    await queryRunner.query(
      `CREATE INDEX "idx_languages_id" ON "languages" ("id")`,
    );

    // Add languageId column to scenario_voices
    await queryRunner.query(`
      ALTER TABLE "scenario_voices" 
      ADD COLUMN "languageId" INTEGER
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "scenario_voices"
      ADD CONSTRAINT "FK_scenario_voices_language" 
      FOREIGN KEY ("languageId") 
      REFERENCES "languages"("id")
      ON DELETE SET NULL
    `);

    // Insert languages data
    await queryRunner.query(`
      INSERT INTO "languages" ("value", "label", "translationCode") VALUES
          (DEFAULT, 'en-IN', 'English (India)', true, 'en'),
          (DEFAULT, 'hi-IN', 'Hindi (India)', true, 'hi'),
          (DEFAULT, 'bn-IN', 'Bengali (India)', true, 'bn'),
          (DEFAULT, 'te-IN', 'Telugu (India)', true, 'te'),
          (DEFAULT, 'mr-IN', 'Marathi (India)', true, 'mr'),
          (DEFAULT, 'ta-IN', 'Tamil (India)', true, 'ta'),
          (DEFAULT, 'gu-IN', 'Gujarati (India)', true, 'gu'),
          (DEFAULT, 'kn-IN', 'Kannada (India)', true, 'kn'),
          (DEFAULT, 'ml-IN', 'Malayalam (India)', true, 'ml'),
          (DEFAULT, 'pa-IN', 'Punjabi (India)', true, 'pa'),
          (DEFAULT, 'or-IN', 'Odia (India)', true, 'or')
    `);

    // Update existing scenario_voices with languageId 1 as we have only one language for now
    await queryRunner.query(`
      UPDATE "scenario_voices" sv
      SET "languageId" = 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key first
    await queryRunner.query(`
      ALTER TABLE "scenario_voices" 
      DROP CONSTRAINT IF EXISTS "FK_scenario_voices_language"
    `);

    // Drop the languageId column
    await queryRunner.query(`
      ALTER TABLE "scenario_voices" 
      DROP COLUMN IF EXISTS "languageId"
    `);

    // Drop the index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_languages_translation_code"`,
    );

    // Drop the languages table
    await queryRunner.query(`DROP TABLE IF EXISTS "languages"`);
  }
}
