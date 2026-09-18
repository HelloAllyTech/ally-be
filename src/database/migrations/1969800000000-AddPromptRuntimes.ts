import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `prompts.runtimes` — which runtimes actually read a prompt.
 *
 * Added so the admin model picker can offer what a prompt can really run. It
 * had no way to know, so it offered only models EVERY runtime supports — the
 * safe rule, and the wrong one for a prompt with a single consumer. Builder's
 * interviewer prompt is read by ally-be alone, where Anthropic runs fine, yet
 * the intersection excludes Anthropic because the voice runtime cannot execute
 * it. The effect was one-way: Builder could be switched off Claude from the UI
 * and never back.
 *
 * Nullable with no backfill, on purpose. NULL means "undeclared", and the
 * picker treats undeclared exactly as it behaves today, so every prompt that
 * existed before this migration keeps its current options until a `.meta.json`
 * sidecar declares otherwise. Expand-only: nothing reads the column until the
 * code that understands it deploys.
 */
export class AddPromptRuntimes1969800000000 implements MigrationInterface {
  name = 'AddPromptRuntimes1969800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" ADD COLUMN IF NOT EXISTS "runtimes" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "prompts" DROP COLUMN IF EXISTS "runtimes"`,
    );
  }
}
