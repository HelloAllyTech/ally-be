import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds BLANK, INACTIVE tooltip placeholders for the WhatsApp bot admin, following the convention
 * set by SeedBasicSettingsTooltipPlaceholders: a superadmin authors the text and flips `active` on
 * under Manage Tooltips when they are happy with the wording.
 *
 * Seeded blank on purpose. A tooltip carrying developer-written placeholder text is worse than no
 * tooltip: it looks authoritative, nobody reviews it, and the screens it explains are the ones where
 * a wrong explanation costs the most — retrieval thresholds, the crisis safety net, and how long
 * identifiable data about mental healthcare workers is kept.
 *
 * Keep these slugs in sync with the `TooltipLocation` enum in
 * ally-admin-dashboard/src/constants/common.ts.
 */
export class SeedWhatsAppBotTooltips1892000000010 implements MigrationInterface {
  name = 'SeedWhatsAppBotTooltips1892000000010';

  private readonly locations = [
    // Settings — the controls whose wrong setting is hardest to notice.
    'wa_crisis_classifier',
    'wa_retention_days',
    'wa_decline_similarity',
    'wa_min_similarity',
    'wa_translate_query',
    'wa_rate_limit',
    'wa_conversation_idle',
    // Corpus — where "why is nothing happening" is the common question.
    'wa_corpus_status',
    'wa_corpus_chunks',
    'wa_corpus_source_type',
    // Conversations — the two that carry a privacy consequence.
    'wa_reveal_phone',
    'wa_block_contact',
    'wa_retrieval_meta',
    // Unanswered queue and usage.
    'wa_unanswered_reason',
    'wa_unanswered_score',
    'wa_usage_decline_rate',
    'wa_usage_language_decline',
    'wa_usage_corpus_coverage',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const location of this.locations) {
      await queryRunner.query(
        `INSERT INTO "tooltips" ("location", "tipText", "active", "createdBy", "updatedBy")
         VALUES ($1, '', false, 0, 0)
         ON CONFLICT ("location") DO NOTHING`,
        [location],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only removes rows still in their seeded blank+inactive state, so a superadmin's authored or
    // enabled content is never dropped on a revert.
    for (const location of this.locations) {
      await queryRunner.query(
        `DELETE FROM "tooltips"
         WHERE "location" = $1
           AND "createdBy" = 0 AND "tipText" = '' AND "active" = false`,
        [location],
      );
    }
  }
}
