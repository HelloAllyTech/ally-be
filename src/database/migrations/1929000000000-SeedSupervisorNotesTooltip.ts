import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the data-driven tooltip for the "Live supervisor notes" toggle on the
 * admin "Edit Simulation → Basic Settings" tab.
 *
 * Seeded WITH text and active=true, following SeedVoiceSessionTooltips rather
 * than the blank-placeholder convention of SeedBasicSettingsTooltipPlaceholders
 * / SeedWhatsAppBotTooltips. The blank convention exists because a
 * developer-written tooltip looks authoritative on the settings whose wrong
 * explanation costs the most — retrieval thresholds, the crisis safety net, data
 * retention. This toggle is not one of those: it is a sibling of the
 * voice-session toggles seeded live in 1793 (Thinking Filler, Comfort Audio,
 * Interim Reply), on the same tab, and what it does is fully observable by
 * turning it on and running a session.
 *
 * Kept to the two-sentence length of its neighbours on that tab (~100-150
 * chars) rather than explaining the whole feature: this renders in a small
 * popover, and a paragraph three times longer than every sibling reads as a
 * wall of text and gets skipped. So it carries only what an author cannot
 * infer from the label — that the learner sees the hints DURING the session,
 * that there are only a few, and that they carry into the debrief. Whether
 * mid-session coaching suits a given learner is a judgement for the roleplay's
 * own guidance, not a tooltip.
 *
 * Keep the slug in sync with the `TooltipLocation` enum in
 * ally-admin-dashboard/src/constants/common.ts. createdBy/updatedBy = 0 marks a
 * system seed; ON CONFLICT preserves any superadmin edit to an existing row.
 */
export class SeedSupervisorNotesTooltip1929000000000
  implements MigrationInterface
{
  name = 'SeedSupervisorNotesTooltip1929000000000';

  private readonly location = 'supervisor_notes_enabled';

  private readonly tipText =
    'An AI supervisor watches the session as it happens and sends the learner a ' +
    'few short coaching hints in a Supervisor tab. The hints also inform their ' +
    'post-session debrief.';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "tooltips" ("location", "tipText", "active", "createdBy", "updatedBy")
       VALUES ($1, $2, true, 0, 0)
       ON CONFLICT ("location") DO NOTHING`,
      [this.location, this.tipText],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove the row if it is still the untouched system seed, so a
    // superadmin's rewrite is never dropped on a revert.
    await queryRunner.query(
      `DELETE FROM "tooltips"
       WHERE "location" = $1 AND "createdBy" = 0 AND "tipText" = $2`,
      [this.location, this.tipText],
    );
  }
}
