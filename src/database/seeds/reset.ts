#!/usr/bin/env node
import { withDataSource, log } from './helpers';
import { DB } from './config';

// Every table any seeder writes to, children before parents (documentation
// only — see note below on why ordering doesn't affect correctness here).
//
// NOT listed on purpose — seeders only ever READ these, migrations own the
// rows: languages, competencies, behaviors (competency_behaviors has a real
// FK to both — truncating behaviors/competencies would cascade-wipe that
// migration-owned join table), groups, permissions, group_permissions,
// roadmap_product_goals, roadmap_opportunity_owners (roadmap.seeder.ts only
// writes the FK-by-name "owner" column on roadmap_opportunities — verified
// live: truncating this table breaks re-seeding with a real FK violation,
// since nothing recreates its rows).
const TABLES_IN_ORDER = [
  // Per-user derived admin access. No FK to "users" at all, so nothing
  // clears this unless it's named here — and a stale row grants whichever
  // user inherits a recycled id (see the "users" RESTART IDENTITY note
  // below) somebody else's feature toggles.
  'admin_feature_toggles',

  // Scenario-session reviews: reactions/comments before threads before the
  // review itself.
  'scenario_session_review_comment_reactions',
  'scenario_session_review_reactions',
  'scenario_session_review_comments',
  'scenario_session_review_threads',
  'scenario_session_review_read_status',
  'scenario_session_reviews',

  // Scribe (helpline) reviews — same shape as the scenario-session ones
  // above.
  'scribe_session_review_comment_reactions',
  'scribe_session_review_reactions',
  'scribe_session_review_comments',
  'scribe_session_review_threads',
  'scribe_session_review_read_status',
  'scribe_session_reviews',

  // Scenario-session leaf data, then the session row itself.
  'scenario_session_message_tags',
  'scenario_session_tags',
  'scenario_session_behavior_instructions',
  'scenario_session_turn_metrics',
  'scenario_session_start_metrics',
  'scenario_session_recordings',
  'scenario_session_feedbacks',
  'scenario_session_chat_messages',
  'scenario_session_chats',
  'scenario_session_details',
  'scenario_session_events',
  'scenario_session_messages',
  'scenario_sessions',

  // Composite-session wrappers built on top of scenario_sessions.
  'case_session_items',
  'case_sessions',
  'scenario_path_session_items',
  'scenario_path_sessions',

  // Tracks — learner progress before enrollment before the track tree.
  'track_journal_entries',
  'track_quiz_attempts',
  'track_item_progress',
  'track_enrollments',
  'track_tenants',
  'track_items',
  'track_sections',
  'tracks',

  // Cases and pathways.
  'case_tenants',
  'case_items',
  'cases',
  'scenario_path_tenants',
  'scenario_path_items',
  'scenario_paths',

  // Scenario content. scenario_behavior_instruction_behaviors is a join
  // table written via raw SQL (wireBehaviorJoins), not a registered entity —
  // easy to miss, so it's called out here explicitly.
  'scenario_behavior_instruction_behaviors',
  'scenario_behavior_instructions',
  'scenario_trigger_warnings',
  'scenario_translations',
  'scenario_versions',
  'scenario_tenants',
  'scenario_voices',
  'scenarios',

  // Scenario-adjacent libraries the seeders own outright.
  'agent_test_cases',
  'scenario_cover_image_library',
  'scenario_characters',
  'trigger_warnings',
  'filler_tags',
  'session_events',

  // Badges.
  'badge_users',
  'badge_tenants',
  'badge_groups',
  'badges',

  // Scribe (helpline) calls: values and messages before their parents.
  'chat_custom_field_values',
  'call_details',
  'messages',
  'chats',
  'custom_field_definitions',
  'preference',

  // Product roadmap. roadmap_product_goals and roadmap_opportunity_owners
  // are migration-owned — excluded (see the file-level comment above).
  'roadmap_user_tab_order',
  'roadmap_saved_views',
  'roadmap_interview_notes',
  'roadmap_opportunity_comments',
  'roadmap_allocations',
  'roadmap_opportunities',

  // AI Lab — answers before questions/assignments before runs.
  'lab_eval_answers',
  'lab_eval_questions',
  'lab_auto_evaluations',
  'lab_run_assignments',
  'lab_runs',
  'lab_question_set_questions',
  'lab_question_sets',
  'lab_evaluators',
  'lab_values',
  'lab_variables',
  'lab_skills',

  // Credits, then identity last.
  'simulation_credits',
  'admin_tenants',
  'user_preferences',
  'user_groups',
  'users',
  'tenants',
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('[seed:reset] refusing to run in production.');
    process.exit(1);
  }

  const confirmed =
    process.argv.includes('--confirm') ||
    process.env.SEED_RESET_CONFIRM === '1';

  if (!confirmed) {
    console.error(
      `[seed:reset] this will TRUNCATE seeded tables in "${DB.database}". ` +
        `pass --confirm (or SEED_RESET_CONFIRM=1) to proceed.`,
    );
    process.exit(1);
  }

  log(`truncating seeded tables in "${DB.database}"...`);

  await withDataSource(async (ds) => {
    const list = TABLES_IN_ORDER.map((t) => `"${t}"`).join(', ');
    await ds.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  });

  log('reset complete.');
}

main().catch((err) => {
  console.error('[seed:reset] failed:', err);
  process.exit(1);
});
