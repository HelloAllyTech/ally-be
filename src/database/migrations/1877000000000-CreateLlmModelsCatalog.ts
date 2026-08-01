import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the LLM model catalog out of the hardcoded `LLM_MODEL_REGISTRY` array
 * and into `llm_models`, so a model that a provider retires can be replaced from
 * the admin dashboard instead of waiting for a deploy.
 *
 * Additive and reversible: a new table only, no existing column touched. The
 * serving code falls back to the in-code list when this table is empty or
 * unreadable, so the endpoint keeps working whether or not this has run.
 *
 * `runtimes` is deliberately NOT a column — it is a property of the provider and
 * of deployed code (ai-learn has no Anthropic branch), so it stays in
 * PROVIDER_RUNTIME_MATRIX and is joined in at read time. See
 * docs/prompt-llm-config-standardization-adr.md.
 *
 * The seed mirrors LLM_MODEL_REGISTRY at the time of writing. `supportsTemperature`
 * follows `modelSupportsTemperature`: false for the o-series and gpt-5 families,
 * which reject a custom temperature, true otherwise.
 */
export class CreateLlmModelsCatalog1877000000000 implements MigrationInterface {
  name = 'CreateLlmModelsCatalog1877000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "llm_models" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "provider" character varying NOT NULL,
        "model" character varying NOT NULL,
        "label" character varying NOT NULL,
        "supportsTemperature" boolean NOT NULL DEFAULT true,
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_llm_models_id" PRIMARY KEY ("id")
      )
    `);

    // One row per provider+model: the catalog answers "does this model work",
    // which is a question about the model, not about any config referencing it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_llm_models_provider_model_idx"
        ON "llm_models" ("provider", "model")
    `);

    await queryRunner.query(`
      INSERT INTO "llm_models" ("provider", "model", "label", "supportsTemperature")
      VALUES
        ('openai',    'gpt-4.1',              'GPT-4.1',            true),
        ('openai',    'gpt-4.1-mini',         'GPT-4.1 mini',       true),
        ('openai',    'gpt-4o',               'GPT-4o',             true),
        ('openai',    'gpt-4o-mini',          'GPT-4o mini',        true),
        ('openai',    'gpt-5',                'GPT-5',              false),
        ('openai',    'gpt-5-mini',           'GPT-5 mini',         false),
        ('gemini',    'gemini-2.5-pro',       'Gemini 2.5 Pro',     true),
        ('gemini',    'gemini-2.5-flash',     'Gemini 2.5 Flash',   true),
        ('anthropic', 'claude-sonnet-4-6',    'Claude Sonnet 4.6',  true),
        ('anthropic', 'claude-haiku-4-5',     'Claude Haiku 4.5',   true),
        ('anthropic', 'claude-opus-4-7',      'Claude Opus 4.7',    true)
      ON CONFLICT ("provider", "model") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_llm_models_provider_model_idx"`);
    await queryRunner.query(`DROP TABLE "llm_models"`);
  }
}
