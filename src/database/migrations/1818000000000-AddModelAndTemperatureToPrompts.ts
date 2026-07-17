import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds prompt-level LLM overrides to the `prompts` table:
 *  - `model` (varchar, nullable): per-prompt model override (e.g. 'gpt-4o',
 *    'gemini-2.0-flash'). Only OpenAI/Gemini are supported by the voice runtime.
 *  - `temperature` (numeric, nullable): per-prompt sampling temperature (0–2).
 *
 * Both are nullable; null means "fall back to the code/language default". They
 * sit between the code/language defaults and any simulation-level value in the
 * precedence chain (code default → language llm_config → prompt-level →
 * simulation override) and are forwarded to ally-ai-learn inside
 * promptData.prompts[promptCode].
 */
export class AddModelAndTemperatureToPrompts1818000000000 implements MigrationInterface {
  name = 'AddModelAndTemperatureToPrompts1818000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "model" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "temperature" numeric`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "temperature"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "model"`,
    );
  }
}
