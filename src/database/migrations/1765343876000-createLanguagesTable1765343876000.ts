import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLanguagesTable1765343876000 implements MigrationInterface {
  name = 'CreateLanguagesTable1765343876000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

    await queryRunner.query(
      `CREATE INDEX "idx_languages_translation_code" ON "languages" ("translationCode")`,
    );

    // Insert languages data
    await queryRunner.query(`
        INSERT INTO "languages" ("id", "value", "label", "active", "translationCode") VALUES
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "idx_languages_translation_code"`);
    await queryRunner.query(`DROP TABLE "languages"`);
  }
}
