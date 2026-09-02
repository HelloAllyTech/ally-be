import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pin the adjudication prompt to temperature 0.
 *
 * The row carried `temperature = NULL`, so it inherited a non-zero provider
 * default — and the adjudicator makes an IRREVERSIBLE decision. Measured
 * 2026-09-02: the same Tamil proposal was accepted at 15:00 and rejected at
 * 16:00 on byte-identical input, both verdicts individually defensible. A
 * borderline call decided permanently by sampling noise.
 *
 * The repeat-before-reject gate (two consecutive votes) is the safety net for
 * that variance. This is the other half: reduce the variance rather than only
 * catching it, so the gate fires on genuine disagreement instead of on noise,
 * and a clear-cut verdict repeats reliably on the next pass.
 *
 * Scoped to `glossary_adjudication` alone. Consolidation is left as it is —
 * generating candidate rules benefits from some diversity, and its output is
 * reviewed before anything is published.
 *
 * `down` restores NULL rather than guessing a previous value, since NULL is
 * what the row actually held.
 */
export class PinGlossaryAdjudicationTemperature1949000000000 implements MigrationInterface {
  name = 'PinGlossaryAdjudicationTemperature1949000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "temperature" = 0
        WHERE "promptCode" = 'glossary_adjudication'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "prompts" SET "temperature" = NULL
        WHERE "promptCode" = 'glossary_adjudication'`,
    );
  }
}
