import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an explicit `provider` (varchar, nullable) to the `prompts` table for the
 * prompt-level LLM override. Storing the provider removes the brittle
 * model-name prefix inference the runtimes previously relied on (a custom or
 * new model id could resolve to the wrong provider). Null means "infer from the
 * model name" for backward compatibility. See
 * prompt-llm-config-standardization-adr.md (phase 2).
 */
export class AddProviderToPrompts1802000000000 implements MigrationInterface {
  name = 'AddProviderToPrompts1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "provider" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "provider"`,
    );
  }
}
