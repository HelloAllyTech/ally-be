import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnUsLanguageAndSplitEnGB1776236000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const openaiLlmConfig = JSON.stringify({
      provider: 'openai',
      config: { model: 'gpt-4o-mini' },
    });
    const deepgramSttConfig = JSON.stringify({
      provider: 'deepgram',
      config: { model: 'nova-3' },
    });

    // Upsert en-GB as 'English (UK)' — inserts if missing, updates label if exists
    await queryRunner.query(
      `
      INSERT INTO "languages" ("value", "label", "active", "translationCode", "llmProviderConfig", "sttProviderConfig")
      VALUES ('en-GB', 'English (UK)', true, 'en', $1, $2)
      ON CONFLICT ("value") DO UPDATE SET "label" = 'English (UK)'
    `,
      [openaiLlmConfig, deepgramSttConfig],
    );

    // Upsert en-US as 'English (US)'
    await queryRunner.query(
      `
      INSERT INTO "languages" ("value", "label", "active", "translationCode", "llmProviderConfig", "sttProviderConfig")
      VALUES ('en-US', 'English (US)', true, 'en', $1, $2)
      ON CONFLICT ("value") DO UPDATE SET "label" = 'English (US)'
    `,
      [openaiLlmConfig, deepgramSttConfig],
    );

    // Reassign scenario_voices with en-US voice names to the en-US language row
    await queryRunner.query(`
      UPDATE "scenario_voices"
      SET "languageId" = (SELECT id FROM "languages" WHERE "value" = 'en-US')
      WHERE "languageId" = (SELECT id FROM "languages" WHERE "value" = 'en-GB')
        AND (config->>'voice_name' LIKE 'en-US-%' OR config->>'languageCode' = 'en-US')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reassign en-US voices back to en-GB
    await queryRunner.query(`
      UPDATE "scenario_voices"
      SET "languageId" = (SELECT id FROM "languages" WHERE "value" = 'en-GB')
      WHERE "languageId" = (SELECT id FROM "languages" WHERE "value" = 'en-US')
    `);

    // Remove the en-US language row
    await queryRunner.query(`DELETE FROM "languages" WHERE "value" = 'en-US'`);

    // Revert en-GB label back to 'English (Global)'
    await queryRunner.query(
      `UPDATE "languages" SET "label" = 'English (Global)' WHERE "value" = 'en-GB'`,
    );
  }
}
