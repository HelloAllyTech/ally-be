import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strips the removed voice-expression toggles from every scenario's metadata
 * JSONB: `enableProsody` (speech prosody), `enablePerformativeText`
 * (Performative Speech), and `enableBreakTags` (Break Tags). All three features
 * have been removed end-to-end (ally-ai-learn / ally-be / ally-web), so the keys
 * are now dead data.
 *
 * The jsonb `-` operator removes a key if present and is a no-op otherwise.
 * One-way cleanup — `down()` is a no-op (original per-scenario values are not
 * recoverable). Leaving the keys would be harmless (nothing reads them), so this
 * is purely tidy-up.
 */
export class StripVoiceExpressionFlagsFromScenarioMetadata1800000000000 implements MigrationInterface {
  name = 'StripVoiceExpressionFlagsFromScenarioMetadata1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "scenarios"
          SET "metadata" = "metadata" - 'enableProsody'
                                      - 'enablePerformativeText'
                                      - 'enableBreakTags'
        WHERE "metadata" IS NOT NULL
          AND "metadata" ?| array['enableProsody', 'enablePerformativeText', 'enableBreakTags']`,
    );
  }

  public async down(): Promise<void> {
    // No-op: removed flags are not restored (original values are not recoverable).
  }
}
