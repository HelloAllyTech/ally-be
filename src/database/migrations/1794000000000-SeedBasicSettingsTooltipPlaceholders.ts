import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds BLANK, INACTIVE placeholder tooltip rows for the remaining admin
 * "Edit Simulation → Basic Settings" toggles (everything except the five
 * voice-session toggles already seeded in SeedVoiceSessionTooltips).
 *
 * Why blank + inactive: the admin UI wires each toggle to a `location` slug
 * (ally-web TooltipLocation), but the text is intentionally left empty so a
 * superadmin can author it under Manage Tooltips and flip `active` on when
 * ready. Until then `active = false` keeps the row out of GET /v1/tooltips/active,
 * so ToggleSection renders no info icon. Seeding the rows (rather than leaving
 * the table empty) means they show up in the management list pre-created with
 * the correct slug — the superadmin just edits + enables.
 *
 * Keep slugs in sync with the `TooltipLocation` enum in
 * ally-admin-dashboard/src/constants/common.ts. createdBy/updatedBy = 0 marks a
 * system seed. ON CONFLICT preserves any pre-existing/edited row.
 */
export class SeedBasicSettingsTooltipPlaceholders1794000000000 implements MigrationInterface {
  name = 'SeedBasicSettingsTooltipPlaceholders1794000000000';

  private readonly locations: string[] = [
    'session_timer',
    'score',
    'ai_feedback_summary',
    'allow_pause_resume',
    'default_org_visibility',
    'public_visibility',
    'conversational_guardrails',
    'speech_prosody',
    'current_state',
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
    // Only remove rows still in their seeded blank+inactive state, so a
    // superadmin's authored/enabled content is never dropped on revert.
    await queryRunner.query(
      `DELETE FROM "tooltips"
       WHERE "location" = ANY($1)
         AND "createdBy" = 0 AND "tipText" = '' AND "active" = false`,
      [this.locations],
    );
  }
}
