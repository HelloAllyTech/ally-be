import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which pipeline drafted a suggestion: the original analytics-window
 * Generate run, or the UX Signals scan over PostHog telemetry.
 *
 * The two share this queue and one accept/reject flow on purpose — a reviewer
 * decides about a proposal the same way whatever produced it. The column exists so
 * they can tell what KIND of evidence backs a card, because "38% of sessions end
 * on this route" and "learner activation fell this quarter" invite different
 * questions.
 *
 * NOT NULL with a default rather than a nullable column plus a backfill: every
 * suggestion that existed before UX Signals came from a window run, so the default
 * IS the historical truth and there is no ambiguous middle state to represent.
 *
 * `character varying(20)` with a CHECK, per repo convention (see
 * AnalyticsSuggestionStatus) — not a Postgres enum, which cannot gain a value
 * without a table rewrite. Both current values fit inside 20 characters; the
 * longer, 'analytics_window', is 16.
 */
export class AddAnalyticsSuggestionSource1940100000000 implements MigrationInterface {
  name = 'AddAnalyticsSuggestionSource1940100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_suggestions"
       ADD COLUMN "source" character varying(20) NOT NULL DEFAULT 'analytics_window'`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_suggestions"
       ADD CONSTRAINT "CHK_analytics_suggestions_source"
       CHECK ("source" IN ('analytics_window', 'ux_signal'))`,
    );
    // Partial index: the UX pipeline's anti-repetition context reads its own
    // pending and rejected rows on every scan, and that is the only query that
    // filters on source. Indexing the whole column would serve nothing else.
    await queryRunner.query(
      `CREATE INDEX "idx_analytics_suggestions_source_status"
       ON "analytics_suggestions" ("source", "status")
       WHERE "source" = 'ux_signal'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_analytics_suggestions_source_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_suggestions"
       DROP CONSTRAINT IF EXISTS "CHK_analytics_suggestions_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_suggestions" DROP COLUMN IF EXISTS "source"`,
    );
  }
}
