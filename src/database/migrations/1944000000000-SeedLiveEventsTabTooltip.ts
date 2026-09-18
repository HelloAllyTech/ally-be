import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the data-driven tooltip for the "Live events tab" toggle on the admin
 * "Edit Simulation → Basic Settings" tab.
 *
 * The toggle has carried `TooltipLocation.LIVE_TAB_ENABLED` since it was added,
 * but no migration ever seeded the row, so the slug resolved to nothing and the
 * control rendered with no tooltip at all. This is the missing row, not a
 * rewrite of an existing one — ON CONFLICT DO NOTHING so that a tooltip a
 * superadmin has since written through Manage Tooltips is left untouched.
 *
 * Seeded WITH text and active=true, following SeedSupervisorNotesTooltip
 * (1929) — its immediate sibling on this tab — rather than the blank-placeholder
 * convention. Same reasoning: the blank convention is for settings whose wrong
 * explanation is expensive (retrieval thresholds, the crisis safety net,
 * retention). This one is fully observable by turning it on and running a
 * session.
 *
 * Kept to the ~100-150 chars of its neighbours on that tab, so it carries only
 * what the label cannot: that the feed is the scored coaching events the AI
 * detects (not, as the toggle's old "Live transcript tab" label implied, a
 * transcript of what was said), that the learner sees them mid-session, and
 * that a roleplay running a checklist shows the checklist instead. Whether
 * mid-session feedback suits a given learner is a judgement for the roleplay's
 * own guidance, not a tooltip.
 *
 * Keep the slug in sync with the `TooltipLocation` enum in
 * ally-admin-dashboard/src/constants/common.ts. createdBy/updatedBy = 0 marks a
 * system seed.
 */
export class SeedLiveEventsTabTooltip1944000000000 implements MigrationInterface {
  name = 'SeedLiveEventsTabTooltip1944000000000';

  private readonly location = 'live_tab_enabled';

  private readonly tipText =
    'Shows the learner a running feed of the scored moments the AI spots during ' +
    'the session, such as an open-ended question. A roleplay with a checklist ' +
    'shows the checklist instead.';

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
