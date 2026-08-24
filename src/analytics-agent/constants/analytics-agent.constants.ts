/**
 * The Analytics Agent's trust boundary, in one file.
 *
 * The agent turns an administrator's English question into SQL that this
 * service then runs against the primary database. That makes ally-be — not the
 * model, and not the browser — responsible for what is reachable. Three
 * independent controls, because any one of them can be argued around:
 *
 *  1. {@link ALLOWED_TABLES} — the agent can only read these tables. An
 *     allowlist, not a denylist: a table added to the schema next month is
 *     unreachable until someone deliberately lists it here, which is the safe
 *     default for a surface that writes its own queries.
 *  2. {@link DENIED_COLUMNS} / {@link DENIED_COLUMN_PATTERNS} — identifiers that
 *     may never appear in a query at all, even inside an aggregate. Secrets,
 *     personal contact details, and the free-text columns that carry session
 *     content: this is an *aggregate* analytics tool, and rows leave the
 *     database twice (to the reader's screen, and to the LLM that narrates
 *     them), so anything PHI-bearing stays out of reach entirely.
 *  3. The execution envelope in the executor — read-only transaction,
 *     statement timeout, row cap.
 *
 * Widening any of these is a product decision about what an administrator may
 * see and what may be sent to an LLM, not a bug fix. The wiki records the
 * policy (product/data-visualisation.md principle 10, and the house privacy
 * rule); change both together.
 */

/**
 * Tables the agent may read, grouped as the schema reference groups them
 * (DATA_SCHEMA.md §3). Each entry carries a one-line purpose that is rendered
 * into the planner's catalogue — the model chooses far better tables when it is
 * told what a table is *for* than when it only sees a name.
 *
 * Deliberately excluded, and why:
 *  - `refresh_token`, `lab_evaluators`, `cloud_telephony_integrations` — hold
 *    credentials/hashes.
 *  - `messages`, `scenario_session_messages`, `call_details`, `chat_*` content,
 *    `scenario_session_chat_messages`, `copilot_messages` — carry conversation
 *    content (help-seeker speech is PHI-adjacent by default here).
 *  - `audit_logs` — carries IP addresses and user agents alongside actor ids.
 *  - `users` is included but its contact columns are denied below: "how many
 *    learners" and "which orgs are growing" are the questions this tool is for.
 *
 * Keys prefixed `analytics_agent_` name a Postgres VIEW, not the physical
 * table (created by migration 1932000000000-CreateAnalyticsAgentTestTenant
 * ExclusionViews), that pre-filters out rows belonging to a tenant flagged
 * `tenants."isTestOrganization" = true` (Ally's own internal/demo/QA org). This
 * is the Analytics Agent's equivalent of the `excludeTestTenants*` predicates
 * every other analytics repository applies per-query (src/analytics/util/
 * test-tenant.util.ts) — baked into the relation instead of the query, because
 * an LLM-authored SELECT can take any shape and might never reference `tenants`
 * itself. Every table that carries tenant-, session-, or user-attributable
 * usage data is filtered this way; genuinely tenant-agnostic reference/catalog/
 * authoring tables (scenarios, tracks, prompts, etc.) are left as plain tables.
 * A new fact table added here MUST get a matching view in a new migration
 * rather than being pointed at the raw table directly.
 */
export const ALLOWED_TABLES: Readonly<Record<string, string>> = Object.freeze({
  // Identity, tenancy, reference data
  analytics_agent_users:
    'Platform accounts — one row per person. Contact columns are not readable.',
  analytics_agent_tenants: 'Organisations ("orgs"). The tenant root entity.',
  analytics_agent_admin_tenants: 'Which users administer which tenants.',
  groups: 'User groups, used both for RBAC and for content targeting.',
  analytics_agent_user_groups:
    'Join user -> group. The usual way to count users by role.',
  permissions: 'Permission catalog.',
  group_permissions: 'Join group -> permission.',
  languages: 'Supported languages. Join target for language_id columns.',

  // Scenario authoring
  scenarios: 'Training scenarios (the simulated roleplays learners practise).',
  analytics_agent_scenario_tenants:
    'Join: which orgs a scenario is shared with.',
  competencies: 'Higher-order skill groupings referenced by scenarios.',
  behaviors: 'Skills/behaviours a learner can demonstrate.',
  scenario_paths: 'Ordered curricula of scenarios.',
  scenario_path_items: 'One step in a path (path -> scenario, with an order).',
  analytics_agent_scenario_path_sessions: "A learner's run through a path.",
  analytics_agent_scenario_path_session_items:
    'Per-step progress within a path run.',

  // Tracks (Track 2.0)
  tracks: 'Multi-component learning tracks (the successor to paths).',
  track_sections: 'Ordered sections within a track.',
  track_items:
    'Ordered items in a section, typed ROLEPLAY | CASE | QUIZ | ARTICLE | VIDEO | JOURNAL.',
  analytics_agent_track_tenants: 'Join: which orgs a track is shared with.',
  analytics_agent_track_enrollments:
    "A learner's enrollment in a track, with completion progress.",
  analytics_agent_track_item_progress:
    'Per-item progress. Rows are created for every item at enrollment, so a LOCKED row means "not reached", not "not enrolled".',
  analytics_agent_track_quiz_attempts:
    'One row per quiz attempt, with its score and pass flag.',

  // Session runtime — the main analytics fact tables
  analytics_agent_scenario_sessions:
    'THE central fact table: one simulated roleplay run. counselor_id is the LEARNER who practised; a run is tenant-scoped and carries its own start/end and score.',
  analytics_agent_scenario_session_details:
    'One row per session (unique on scenario_session_id): call duration in seconds, the composite evaluation score, and the async evaluation status.',
  analytics_agent_scenario_session_events:
    'Events that fired during a run, with when they occurred.',
  analytics_agent_scenario_session_feedbacks:
    "The learner's post-session rating (CSAT).",
  analytics_agent_scenario_session_turn_metrics:
    "Per-turn latency telemetry (response latency, time-to-first-token, TTS time-to-first-byte, model, language, interruption and timeout flags). Wide table; percentiles come from here. response_latency_ms is time to the agent's FIRST audio, which is a thinking-filler or interim reply when one played — metadata->>'firstAudioSource' ('filler'|'interim'|'reply', absent on older rows) says which, and metadata->>'replyLatencyMs' holds the unmasked time to the real reply on masked turns. Split by firstAudioSource before trending response_latency_ms, or a rise in filler coverage reads as a latency improvement.",
  analytics_agent_scenario_session_start_metrics:
    'Per-session start latency ("time to first word"), one row per simulation, with its segment breakdown.',
  analytics_agent_scenario_session_reviews:
    'Reviews of training sessions (status and author only).',

  // Cases
  cases: 'Training/assessment cases — bundles of scenarios.',
  case_items: 'A scenario within a case.',
  analytics_agent_case_sessions: "A learner's progress through a case.",
  analytics_agent_case_session_items: 'Per-item progress within a case run.',
  analytics_agent_case_tenants: 'Join: which orgs a case is shared with.',

  // Chats — metadata only; message content is not readable
  analytics_agent_chats:
    'Live counsellor<->help-seeker sessions, METADATA ONLY (status, timing, tenant). No message content is reachable from here.',
  analytics_agent_queue_entries:
    'The help-seeker waiting queue: wait start, status, priority.',

  // Engagement
  analytics_agent_user_daily_scores:
    'Daily engagement rollup per user (minutes played, score, one row per user/day). The prime source for activity over time.',
  badges: 'Badge definitions.',
  analytics_agent_badge_users: 'Badges earned, per user.',

  // Roleplay Studio v2
  roleplay_specs: 'v2 authoring root — one spec document per roleplay.',
  roleplay_spec_versions:
    'Immutable spec snapshots (append-only version history).',
  analytics_agent_roleplay_rubric_scores:
    'Per-(turn, behaviour) rubric scores from v2 runs.',
  analytics_agent_roleplay_director_events:
    'v2 director telemetry, one row per director message.',

  // Platform ops
  analytics_agent_llm_usage:
    'Token/cost accounting: one row per LLM, STT or TTS call, labelled by provider, model and task. The source for AI spend.',
  prompts:
    'Prompt registry for the agent pipeline (metadata; prompt text is not readable).',
  prompts_versions: 'Prompt version history (metadata only).',
  lab_skills: 'AI Lab prompt templates (metadata only).',
  lab_runs: 'AI Lab executions, with model, status, tokens and cost.',
  dashboards: 'Analytics dashboard registry.',
  blogs: 'Platform blog posts (title, status, publication date).',
});

/**
 * Exact column names the agent may never reference. Secrets first, then direct
 * personal contact details, then the free-text columns that carry session or
 * message content.
 *
 * Matched as whole identifiers anywhere in the query — including inside
 * `COUNT(...)` — because "just counting" a denied column still requires reading
 * it, and a `WHERE content ILIKE '%...%'` turns an aggregate into a search over
 * conversation text.
 */
export const DENIED_COLUMNS: readonly string[] = Object.freeze([
  // Credentials and tokens
  'password',
  'password_hash',
  'token',
  'token_version',
  'credentials',
  'secret',
  'api_key',
  // Direct contact details / identifiers of a person
  'email',
  'phone',
  'external_id',
  'ip_address',
  'user_agent',
  // Free text that can carry session content, PHI or a whole transcript
  'content',
  'transcript',
  'summary',
  'message',
  'evaluation_markdown',
  'evaluationmarkdown',
  'report_markdown',
  'character_profile_text',
  'resolved_prompt',
  'answer_text',
  'response',
  'rationale',
  'reasoning',
  'note',
  'feedback',
  'body',
  'output',
  'prompt',
  'default_prompt',
  'draftspec',
  'spec',
  'payload',
  'detection_data',
  'style_exemplars',
]);

/**
 * Substring patterns for the same policy, so a column that follows a naming
 * convention is covered without being enumerated. Applied to identifiers only.
 */
export const DENIED_COLUMN_PATTERNS: readonly RegExp[] = Object.freeze([
  /password/i,
  /secret/i,
  /_token$/i,
  /^token_/i,
  /api_?key/i,
  /credential/i,
]);

/**
 * SQL that may never appear, whatever else the query does. The read-only
 * transaction already blocks writes; this list exists so a violation is
 * reported to the reader as "the agent tried to do X" rather than surfacing as
 * a Postgres error, and so the filesystem/catalog/sleep functions — which a
 * read-only transaction happily runs — are refused outright.
 */
export const FORBIDDEN_SQL_TOKENS: readonly string[] = Object.freeze([
  'insert',
  'update',
  'delete',
  'merge',
  'upsert',
  'drop',
  'alter',
  'create',
  'truncate',
  'grant',
  'revoke',
  'comment',
  'copy',
  'vacuum',
  'reindex',
  'cluster',
  'refresh',
  'discard',
  'listen',
  'notify',
  'unlisten',
  'lock',
  'set',
  'reset',
  'begin',
  'start',
  'commit',
  'rollback',
  'savepoint',
  'prepare',
  'execute',
  'deallocate',
  'declare',
  'fetch',
  'move',
  'close',
  'call',
  'do',
  'explain',
  'analyse',
  'analyze',
  'into',
  'returning',
]);

/** Dangerous functions and schemas, matched as substrings (case-insensitive). */
export const FORBIDDEN_SQL_FRAGMENTS: readonly string[] = Object.freeze([
  'pg_sleep',
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'pg_logdir_ls',
  'pg_catalog',
  'information_schema',
  'pg_class',
  'pg_tables',
  'pg_user',
  'pg_shadow',
  'pg_authid',
  'pg_roles',
  'pg_settings',
  'current_setting',
  'set_config',
  'lo_import',
  'lo_export',
  'dblink',
  'postgres_fdw',
  'copy_from',
  'query_to_xml',
  'pg_terminate_backend',
  'pg_cancel_backend',
]);

/**
 * Hard caps on one question.
 *
 * ROW_LIMIT bounds what the query may return; the executor asks for one row
 * more than this so it can tell "exactly at the cap" from "there was more",
 * which is the difference between a total and a lower bound.
 *
 * NARRATION_ROW_LIMIT bounds what is sent to the LLM. It is smaller on purpose:
 * a chart and a scrollable table can hold hundreds of rows usefully, while a
 * narration prompt cannot, and every row sent is a row leaving this service.
 */
export const AGENT_LIMITS = Object.freeze({
  ROW_LIMIT: 500,
  NARRATION_ROW_LIMIT: 100,
  /** Postgres `statement_timeout` for the agent's query. */
  STATEMENT_TIMEOUT_MS: 20_000,
  /** Longest question accepted, so a prompt cannot be smuggled in wholesale. */
  MAX_QUESTION_CHARS: 1_000,
  /** Turns of prior conversation forwarded for follow-up resolution. */
  MAX_HISTORY_TURNS: 8,
  /** Longest SQL the planner may return. */
  MAX_SQL_CHARS: 8_000,
  /** HTTP timeout per ally-ai call (two calls per question). */
  AI_TIMEOUT_MS: 120_000,
});
