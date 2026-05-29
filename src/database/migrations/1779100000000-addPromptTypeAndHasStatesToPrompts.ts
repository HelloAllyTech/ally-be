import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds promptType (role/category) and hasStates (States-section toggle)
 * columns to the prompts table. Backfills promptType for the three existing
 * roles based on promptCode pattern. hasStates defaults to false everywhere.
 *
 * Orthogonal to existing `kind` column, which distinguishes 'prompt' vs
 * 'block' and is not touched here.
 */
export class AddPromptTypeAndHasStatesToPrompts1779100000000 implements MigrationInterface {
  name = 'AddPromptTypeAndHasStatesToPrompts1779100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN "promptType" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN "hasStates" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_prompts_prompt_type" ON "prompts" ("promptType")`,
    );

    // Backfill promptType for existing rows based on promptCode pattern.
    // ai-learn prompt codes are prefixed with "ally_ai_learn_" and contain
    // role identifiers in the path (e.g. ally_ai_learn_system_main_agent_prompt).
    await queryRunner.query(
      `UPDATE "prompts" SET "promptType" = 'main_agent' WHERE "promptCode" LIKE '%main_agent%'`,
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "promptType" = 'branching' WHERE "promptCode" LIKE '%branching%'`,
    );
    await queryRunner.query(
      `UPDATE "prompts" SET "promptType" = 'multilingual' WHERE "promptCode" LIKE '%multilingual%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_prompts_prompt_type"`);
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "hasStates"`,
    );
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "promptType"`,
    );
  }
}
