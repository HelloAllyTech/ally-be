import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2/3 of the language-capability eval (see
 * language-capability-eval-implementation-plan.md):
 *
 * - languages.evalConfig (jsonb) — FR19 per-language declarative config:
 *   { script, errorRateUnit: 'wer'|'cer', targetVariety, diglossia,
 *     codeSwitchPartners, roundTrip: { ttsProvider?, asrProvider? } | null,
 *     judgeReliabilityTier }. All judge prompts, metrics and dashboards read
 *   this; nothing hardcodes a language.
 * - language_judgment_sessions.roundTripWerPct — per-session round-trip
 *   WER/CER % (objective intelligibility metric, FR2), sampled over the
 *   session's AI turns.
 *
 * Seeds sensible defaults for the languages the platform ships with; each is
 * editable data, not code (idempotent: only fills rows whose evalConfig is
 * still empty).
 */
export class AddLanguageEvalConfigAndWer1829000000002 implements MigrationInterface {
  name = 'AddLanguageEvalConfigAndWer1829000000002';

  /** value-prefix → default eval config. */
  private readonly seeds: Array<[string, Record<string, unknown>]> = [
    [
      'en',
      {
        script: 'latin',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: [],
        targetVariety: 'conversational spoken English',
        judgeReliabilityTier: 'high',
      },
    ],
    [
      'hi',
      {
        script: 'devanagari',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Hindi (Hinglish natural)',
        judgeReliabilityTier: 'high',
      },
    ],
    [
      'ta',
      {
        script: 'tamil',
        errorRateUnit: 'wer',
        diglossia: true,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Tamil',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'kn',
      {
        script: 'kannada',
        errorRateUnit: 'wer',
        diglossia: true,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Kannada',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'ml',
      {
        script: 'malayalam',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Malayalam',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'te',
      {
        script: 'telugu',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Telugu',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'bn',
      {
        script: 'bengali',
        errorRateUnit: 'wer',
        diglossia: true,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Bengali',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'mr',
      {
        script: 'devanagari',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Marathi',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'gu',
      {
        script: 'gujarati',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Gujarati',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'pa',
      {
        script: 'gurmukhi',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Punjabi',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'or',
      {
        script: 'odia',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Odia',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'ur',
      {
        script: 'arabic',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Urdu',
        judgeReliabilityTier: 'low',
      },
    ],
    [
      'as',
      {
        script: 'bengali',
        errorRateUnit: 'wer',
        diglossia: false,
        codeSwitchPartners: ['en'],
        targetVariety: 'colloquial spoken Assamese',
        judgeReliabilityTier: 'low',
      },
    ],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "languages" ADD COLUMN IF NOT EXISTS "evalConfig" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "language_judgment_sessions" ADD COLUMN IF NOT EXISTS "roundTripWerPct" double precision`,
    );
    for (const [prefix, config] of this.seeds) {
      await queryRunner.query(
        `UPDATE "languages"
            SET "evalConfig" = $1::jsonb
          WHERE ("value" = $2 OR "value" LIKE $3)
            AND ("evalConfig" IS NULL OR "evalConfig" = '{}'::jsonb)`,
        [JSON.stringify(config), prefix, `${prefix}-%`],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "language_judgment_sessions" DROP COLUMN IF EXISTS "roundTripWerPct"`,
    );
    await queryRunner.query(
      `ALTER TABLE "languages" DROP COLUMN IF EXISTS "evalConfig"`,
    );
  }
}
