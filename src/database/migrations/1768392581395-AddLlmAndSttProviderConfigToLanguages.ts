import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLlmAndSttProviderConfigToLanguages1768392581395
  implements MigrationInterface
{
  name = 'AddLlmAndSttProviderConfigToLanguages1768392581395';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" ADD "llmProviderConfig" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "languages" ADD "sttProviderConfig" jsonb NOT NULL DEFAULT '{}'`,
    );

    // Update LLM provider configs based on language codes
    const languageLlmConfigs: Record<string, Record<string, any>> = {
      'en-IN': { provider: 'openai', config: { model: 'gpt-4o-mini' } },
      'hi-IN': { provider: 'openai', config: { model: 'gpt-4o-mini' } },
      'ml-IN': { provider: 'openai', config: { model: 'gpt-4o-mini' } },
      'bn-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'mr-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'te-IN': { provider: 'google', config: { model: 'chirp_2' } },
      'ta-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'gu-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'kn-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'pa-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'or-IN': {
        provider: 'google',
        config: { model: 'gemini-2.0-flash-exp' },
      },
      'en-GLOBAL': { provider: 'openai', config: { model: 'gpt-4o-mini' } },
    };

    // Update STT provider configs based on language codes
    const languageSttConfigs: Record<string, Record<string, any>> = {
      'en-IN': {
        provider: 'deepgram',
        config: { model: 'nova-3' },
      },
      'hi-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'ml-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'bn-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'mr-IN': {
        provider: 'sarvam',
        config: { model: 'saarika:v2.5' },
      },
      'te-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'ta-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'gu-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'kn-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'pa-IN': {
        provider: 'google',
        config: {
          model: 'chirp_2',
          location: 'asia-southeast1',
          languageCode: 'pa-Guru-IN',
        },
      },
      'or-IN': {
        provider: 'google',
        config: { model: 'chirp_2', location: 'asia-southeast1' },
      },
      'en-GLOBAL': {
        provider: 'deepgram',
        config: { model: 'nova-3' },
      },
    };

    // Update languages table with provider configs
    for (const [languageValue, llmConfig] of Object.entries(
      languageLlmConfigs,
    )) {
      const sttConfig = languageSttConfigs[languageValue];
      await queryRunner.query(
        `UPDATE "languages" SET "llmProviderConfig" = $1, "sttProviderConfig" = $2 WHERE "value" = $3`,
        [JSON.stringify(llmConfig), JSON.stringify(sttConfig), languageValue],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" DROP COLUMN "sttProviderConfig"`,
    );
    await queryRunner.query(
      `ALTER TABLE "languages" DROP COLUMN "llmProviderConfig"`,
    );
  }
}
