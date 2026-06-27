import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the data-driven tooltips for the voice-session toggles on the admin
 * "Edit Simulation → Basic Settings" tab (Thinking Filler, Comfort Audio, Trim
 * History, Continuous Back-channeling, Interim Reply).
 *
 * The admin UI renders an info-icon tooltip next to each toggle by looking up
 * the matching `location` slug from GET /v1/tooltips/active (see
 * ally-web TooltipLocation + ToggleSection). Seeding these rows active=true
 * means the tooltips show out of the box AND are editable by superadmins under
 * Manage Tooltips. Keep the slugs in sync with the `TooltipLocation` enum in
 * ally-admin-dashboard/src/constants/common.ts.
 *
 * createdBy/updatedBy = 0 marks a system seed (same convention as
 * AddAudioTagGuidancePrompt). ON CONFLICT keeps any superadmin edits made to an
 * already-present location intact (re-run / pre-existing rows are left alone).
 */
export class SeedVoiceSessionTooltips1793000000000 implements MigrationInterface {
  name = 'SeedVoiceSessionTooltips1793000000000';

  private readonly tooltips: { location: string; tipText: string }[] = [
    {
      location: 'thinking_filler',
      tipText:
        'Plays a brief spoken acknowledgement the moment the learner stops talking, while the agent generates its reply, so the pause feels less silent.',
    },
    {
      location: 'comfort_audio',
      tipText:
        "Plays a faint, constant background room tone so the line never sounds dead or muted between the agent's replies.",
    },
    {
      location: 'trim_history',
      tipText:
        'Sends only the most recent turns of the conversation to the agent, speeding up responses in longer sessions.',
    },
    {
      location: 'continuous_backchanneling',
      tipText:
        "Lets the agent emit short affirmations like ‘mm-hmm’ while the learner is still speaking, signaling that it's listening.",
    },
    {
      location: 'interim_reply',
      tipText:
        "Has the agent play a quick holding response at the end of the learner's turn, then switch to the full reply once it's ready.",
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { location, tipText } of this.tooltips) {
      await queryRunner.query(
        `INSERT INTO "tooltips" ("location", "tipText", "active", "createdBy", "updatedBy")
         VALUES ($1, $2, true, 0, 0)
         ON CONFLICT ("location") DO NOTHING`,
        [location, tipText],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const locations = this.tooltips.map((t) => t.location);
    await queryRunner.query(
      `DELETE FROM "tooltips" WHERE "location" = ANY($1) AND "createdBy" = 0`,
      [locations],
    );
  }
}
