import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds a broad library of DISABLED tooltips (icon 👉) across the admin and
 * helpline (consumer) apps, so a superadmin can review the copy under Manage
 * Tooltips and enable the good ones — no code deploy needed to turn one on.
 *
 * All rows are active = false, so GET /v1/tooltips/active excludes them and no
 * icon renders until enabled. icon = 👉 (backhand index finger pointing right)
 * per request. createdBy/updatedBy = 0 marks a system seed. ON CONFLICT keeps
 * any pre-existing/edited row untouched.
 *
 * Slugs are mirrored in the `TooltipLocation` enums of both apps
 * (ally-admin-dashboard + ally-helpline-dashboard src/constants/common.ts).
 * Content is a first draft for the superadmin to refine before enabling.
 */
export class SeedTooltipLibraryDisabled1795000000000 implements MigrationInterface {
  name = 'SeedTooltipLibraryDisabled1795000000000';

  private readonly icon = '👉';

  private readonly tooltips: { location: string; tipText: string }[] = [
    // ---- Admin: Edit Simulation form fields ----
    {
      location: 'character_profile_selector',
      tipText:
        "Pick a saved character profile or build a custom one — sets the AI actor's background, personality, and demographics.",
    },
    {
      location: 'character_backstory',
      tipText:
        "The character's life story and emotional context. Drives how the AI actor behaves and stays in role.",
    },
    {
      location: 'custom_fields',
      tipText:
        "Key–value details injected into the prompt as {custom_fields_text}. Use for scenario facts that don't fit other fields.",
    },
    {
      location: 'knowledge_sources',
      tipText:
        'Documents the AI can draw on during the session to ground its replies in case facts or domain knowledge.',
    },
    {
      location: 'trigger_warnings',
      tipText:
        'Sensitive topics in this scenario (e.g. grief, trauma). Shown to learners before they start, for informed consent.',
    },
    {
      location: 'session_max_time',
      tipText:
        'Longest a session can run (HH:MM:SS). The session auto-ends when reached. Applies only when Session Timer is on.',
    },
    {
      location: 'experience_mode_type',
      tipText:
        'Sets how the learner is supported during the session: AI feedback, a guided checklist, or neither.',
    },
    {
      location: 'checklist_type_variant',
      tipText:
        'How the checklist behaves — guided steps, unguided self-check, or a simple reference list. Used only in Checklist mode.',
    },
    {
      location: 'linguistic_style_samples',
      tipText:
        "Example lines showing the character's voice and tone, so the AI replies in a consistent, authentic style.",
    },
    {
      location: 'opening_dialogue_templates',
      tipText:
        'Alternate opening lines the character may use at the start, adding variety across repeat sessions.',
    },
    {
      location: 'auto_termination_rules',
      tipText:
        'Conditions (score, time, or dialogue) that automatically end the session, preventing stuck or endless runs.',
    },
    {
      location: 'language_voice_mapping',
      tipText:
        'Map each language to a voice provider and speaker for the audio the AI actor uses.',
    },
    {
      location: 'session_states_progression',
      tipText:
        "Score-gated stages of the conversation; the AI's behavior and guidance change as the learner advances. Needs a States-enabled prompt.",
    },
    // ---- Admin: Edit Simulation / studio actions ----
    {
      location: 'publish_simulation_version',
      tipText:
        'Make this version live for learners. Edits after publishing go into a new draft version.',
    },
    {
      location: 'unpublish_simulation',
      tipText:
        'Take this version offline. Learners no longer see it until a version is published again.',
    },
    {
      location: 'archive_simulation',
      tipText:
        'Hide this simulation from the studio and stop new assignments. Existing sessions are unaffected; unarchive to restore.',
    },
    {
      location: 'event_branch_instruction',
      tipText:
        'Fallback guidance the AI uses when this event fires but no specific branch rule matches.',
    },
    {
      location: 'event_trigger_conditions',
      tipText:
        'Rules that detect when this event fires — speech similarity, score thresholds, and time/occurrence limits.',
    },
    // ---- Helpline (consumer app) ----
    {
      location: 'calls_refresh_button',
      tipText: 'Reload the list to pull in the latest sessions and calls.',
    },
    {
      location: 'calls_session_menu_button',
      tipText: 'More options for this session, including archive.',
    },
    {
      location: 'review_emoji_reaction_button',
      tipText: 'React with an emoji to give quick feedback on this review.',
    },
    {
      location: 'comment_edit_button',
      tipText: 'Edit your comment.',
    },
    {
      location: 'comment_delete_button',
      tipText: "Delete this comment. This can't be undone.",
    },
    {
      location: 'comment_visibility_toggle',
      tipText: 'Show or hide this comment from others.',
    },
    {
      location: 'session_star_rating',
      tipText: 'Rate this session from 1 (needs work) to 5 (excellent).',
    },
    {
      location: 'credits_display_meter',
      tipText:
        "Each session uses credits from your monthly limit. When it's used up, you can't start new sessions until it resets.",
    },
    {
      location: 'overall_score_meter',
      tipText: 'Your overall performance for this session, from 0 to 100%.',
    },
    {
      location: 'share_for_review_toggle',
      tipText:
        'Share this session with reviewers for feedback. Private sessions stay visible only to you.',
    },
    {
      location: 'scenario_back_button',
      tipText: 'Go back to the learning hub without starting this simulation.',
    },
    {
      location: 'search_category_filter',
      tipText:
        'Filter results by type — scenarios, guides, case studies, and more.',
    },
    {
      location: 'review_show_reactions_modal',
      tipText: 'See all the emoji reactions on this session.',
    },
    {
      location: 'calls_session_score_icon',
      tipText: 'Overall performance score for the session (0–100%).',
    },
    {
      location: 'calls_summary_status_icon',
      tipText:
        'Status of the AI-generated session summary: pending, in progress, or ready.',
    },
    {
      location: 'review_reaction_count_summary',
      tipText: 'Total emoji reactions from reviewers on this feedback.',
    },
    {
      location: 'learn_credits_display',
      tipText: 'Your monthly simulation credit usage.',
    },
    {
      location: 'review_filter_toggle_group',
      tipText:
        'Filter reviews by status — all, pending, approved, or rejected.',
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { location, tipText } of this.tooltips) {
      await queryRunner.query(
        `INSERT INTO "tooltips" ("location", "tipText", "icon", "active", "createdBy", "updatedBy")
         VALUES ($1, $2, $3, false, 0, 0)
         ON CONFLICT ("location") DO NOTHING`,
        [location, tipText, this.icon],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Only remove rows still in their seeded disabled state, so a superadmin's
    // enabled/edited content is never dropped on revert.
    const locations = this.tooltips.map((t) => t.location);
    await queryRunner.query(
      `DELETE FROM "tooltips"
       WHERE "location" = ANY($1) AND "createdBy" = 0 AND "active" = false`,
      [locations],
    );
  }
}
