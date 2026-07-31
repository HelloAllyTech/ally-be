import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Aligns `scenario_voices` with the newer provider registries in two ways.
 *
 * 1. Provider casing. Voices stored 'GOOGLE' while `stt_configs` and
 *    `llm_configs` store 'google', so the shared provider-config validator had
 *    to match case-insensitively and every new consumer had to remember which
 *    convention applied. Normalizing to lower-case makes one convention true
 *    everywhere.
 *
 *    Safe in either deploy order: the code was made case-insensitive first
 *    (`normalizeProviderKey`, plus LOWER() on the provider filter and in the
 *    voice-preview key lookup), so old rows work against new code and new rows
 *    work against old code — ally-ai-learn already lower-cased before
 *    dispatching.
 *
 * 2. A unique index on `name`. `stt_configs` and `llm_configs` both have one;
 *    voices did not, so two voices could share a name and the admin pickers
 *    would show an ambiguous duplicate. Verified no duplicates exist before
 *    adding it — if any appear on another environment this migration fails
 *    loudly rather than silently dropping one.
 */
export class NormalizeVoiceProviderCasingAndUniqueName1874000000000 implements MigrationInterface {
  name = 'NormalizeVoiceProviderCasingAndUniqueName1874000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenario_voices" SET "provider" = lower("provider") WHERE "provider" <> lower("provider")`,
    );

    const duplicates: { name: string; count: string }[] =
      await queryRunner.query(
        `SELECT "name", count(*) AS count FROM "scenario_voices" GROUP BY "name" HAVING count(*) > 1`,
      );
    if (duplicates.length > 0) {
      throw new Error(
        `Cannot add a unique index on scenario_voices.name — duplicates exist: ` +
          duplicates.map((row) => `"${row.name}" x${row.count}`).join(', ') +
          `. Rename them, then re-run.`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_scenario_voices_name_idx" ON "scenario_voices" ("name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_scenario_voices_name_idx"`);
    // Provider casing is deliberately not restored: the code reads it
    // case-insensitively, so upper-casing again would churn rows for nothing.
  }
}
