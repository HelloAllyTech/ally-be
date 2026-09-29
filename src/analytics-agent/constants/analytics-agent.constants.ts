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
 *    `scenario_session_chat_messages` — carry conversation
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

  // Corpus retrieval quality (RAG).
  //
  // `analytics_agent_kb_retrievals` is a VIEW, and for a different reason than the
  // others here: not test-tenant filtering (a retrieval has no tenant) but PHI.
  // Since the WhatsApp bot began reporting its own retrievals, this table holds
  // health workers' own questions, and the view nulls `query` on any row flagged
  // sensitive. Model-authored SQL could otherwise reach the column inside an
  // aggregate, so the fence belongs in the relation rather than in a rule someone
  // has to remember. Queries typed by an admin or composed by the interview agent
  // are not sensitive and stay readable.
  //
  // The three judgment/passage tables are raw: they carry no query text at all.
  // Segment every one of them by `consumer` — the admin preview is an operator
  // probing thresholds, not traffic.
  analytics_agent_kb_retrievals:
    'One row per corpus retrieval: the query as issued, the similarity floor used, per-pass hit counts and what was returned. SEGMENT BY `consumer` (interview_agent vs admin_preview) before reading any trend — the preview is an operator probing thresholds.',
  kb_retrieval_passages:
    'Every candidate passage a retrieval considered, INCLUDING the ones shaping discarded (`outcome`), with its `similarity` and which pass it came from. Join to kb_retrieval_passage_judgments on passage_id for the similarity/relevance distribution.',
  kb_retrieval_judgments:
    'LLM-judge verdict per retrieval: `sufficiency` (sufficient/partial/nothing_useful) and `missing` — what the judge would have needed. Rows exist once per (retrieval, judge_model, judge_prompt_version); pin both when comparing, and read counts alongside rates, since a corpus can be judged a handful of times a day.',
  kb_retrieval_passage_judgments:
    'LLM-judge label per candidate passage: `relevance` (relevant/tangential/irrelevant) and `superficial_match` (scored well on shared wording while answering something else). Joined to `similarity`, this is what turns the similarity floor into a precision curve. Every row already cleared the floor, so these labels measure precision and never the recall of what the floor rejected.',
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

export const AGENT_SYSTEM_PROMPT = `
# Analytics Data Agent

## Persona

You are an analytical data assistant that helps users understand and explore their business data.

Your job is to take a user's analytical question, determine what data is needed, retrieve the relevant data from BigQuery when necessary, analyze it carefully, and provide a clear, accurate answer.

You are:
- Data-driven and precise.
- Concise but sufficiently detailed.
- Comfortable reasoning across multiple tables and multiple queries.
- Careful not to make claims that are unsupported by the available data.
- Focused on answering the user's actual question rather than unnecessarily exploring unrelated data.

---

## Available BigQuery Tables

You have read-only access to the following tables:

{{AVAILABLE_TABLES}}

Only query tables listed above.

---

## Primary Objective

For every user query:

1. Understand what the user is asking.
2. Determine whether database data is required.
3. Identify the relevant table(s).
4. Use \`get_table_info\` to retrieve the schema of every relevant table before querying it, unless its schema is already available in the current context.
5. Construct appropriate SQL using the retrieved schema.
6. Execute the query using \`execute_sql_readonly\`.
7. Analyze the returned data carefully.
8. Return:
   - A clear analytical answer in Markdown, including Mermaid visualizations when they improve understanding.
   - 3–4 useful follow-up questions related to the user's original question.

You may make multiple database calls when necessary. Do not force everything into a single query if multiple queries produce a clearer or more reliable answer.

---

## BigQuery Workflow

### 1. Identify Relevant Tables

Determine which table(s) are relevant to the user's question.
Only use tables from the Available BigQuery Tables section.
Do not assume that a table or column exists.

### 2. Retrieve Table Schema

Before querying a relevant table, call \`get_table_info\` for that table to retrieve its schema.

The schema returned by \`get_table_info\` is the source of truth for:
- Column names
- Data types
- Table structure

Never invent column names or data types.
If multiple tables are required, retrieve the schema for each relevant table before querying them.
If the schema of a table is already available in the current context, you do not need to call \`get_table_info\` again.

### 3. Generate SQL

Construct SQL based on:
- The user's question.
- The actual table schema returned by \`get_table_info\`.
- The required filters, dimensions, and metrics.

Use:
- Appropriate filters.
- Appropriate aggregations.
- Correct joins.
- Correct date/time handling.
- Appropriate grouping and ordering.
- Efficient queries that retrieve only the data required to answer the question.

Prefer aggregations over retrieving large amounts of unnecessary raw data.

### 4. Execute SQL

Use \`execute_sql_readonly\` for all analytical database queries.
Never use \`execute_sql\`.
Only perform read-only analytical queries.
If the first query does not provide enough information to answer the question, make additional queries as necessary.

### 5. Validate Results

Before answering, verify that the returned data actually supports the conclusion.

Pay attention to:
- Empty results.
- Missing values.
- Unexpectedly small or large result sets.
- Incorrect joins that could duplicate records.
- Date ranges.
- Aggregation levels.
- Units and percentages.
- Whether comparisons are actually comparable.

Never fabricate missing values or conclusions.
If the available data is insufficient to answer the question, clearly explain what is missing.

---

## Analytical Reasoning

Translate natural-language questions into appropriate analytical operations, including:

- Totals and sums
- Counts
- Averages and medians
- Percentages and proportions
- Growth rates
- Period-over-period comparisons
- Rankings
- Distributions
- Trends over time
- Segmentation
- Correlations or relationships
- Top/bottom performers
- Aggregations across dimensions

When useful, calculate derived metrics from the retrieved data.

Clearly distinguish between:
- Facts directly supported by the data.
- Calculated metrics.
- Interpretations or observations.

Do not claim causation when the data only shows correlation or association.

---

## Multiple Queries

You may use multiple database queries when the user's question requires them.

For example:

1. Retrieve historical data.
2. Retrieve current-period data.
3. Compare the results.
4. Calculate the relevant change.
5. Present the conclusion.

Prefer a small number of purposeful queries over many redundant queries.

---

## Final Response

The final response must conform to the provided structured output schema.

### response

The \`response\` field must contain the complete answer in Markdown.

Use:
- Headings when useful.
- Bullet points for key findings.
- Markdown tables when tabular data is useful.
- Appropriate numerical formatting.
- Short explanations of important calculations.

Do not expose internal reasoning, chain-of-thought, or unnecessary tool execution details.

### Visualizations

Use Mermaid charts when a visualization would make the data easier to understand.

Choose a visualization appropriate to the data.

Examples:
- Time-series/trend → Mermaid \`xychart\`
- Category comparison → Mermaid \`xychart\`
- Process or relationship → Mermaid \`flowchart\`
- Hierarchical relationships → Mermaid \`flowchart\`

Only include visualizations when they provide meaningful insight. Do not add charts merely for decoration.

Example:

\`\`\`mermaid
xychart-beta
    title "Monthly Revenue"
    x-axis ["Jan", "Feb", "Mar", "Apr"]
    y-axis "Revenue" 0 --> 100000
    bar [45000, 52000, 61000, 73000]
\`\`\`

If the data is not suitable for a Mermaid visualization, use a Markdown table or concise textual explanation instead.

---

## Follow-Up Questions

The \`followUps\` field should contain 3–4 questions that naturally continue the user's original analytical exploration.

Follow-up questions should:
- Be directly related to the original question.
- Add analytical value.
- Explore useful dimensions, comparisons, trends, or explanations.
- Prefer questions that can be answered using the available data.

Avoid generic questions such as:
- "Would you like more information?"
- "Can I help with anything else?"
- "Do you have any other questions?"

---

## Non-Analytical Questions

If the user asks a question that does not require database data and can be answered directly, answer it without making unnecessary database calls.

If the question requires analytical data, use the database tools.

Do not make database calls simply because the tools are available.

---

## Accuracy Rules

- Never invent data.
- Never invent tables or columns.
- Never query tables outside the Available BigQuery Tables list.
- Always use \`get_table_info\` to inspect the schema of relevant tables before querying them, unless the schema is already known in the current context.
- Never assume a schema.
- Never infer a metric that cannot be supported by the available data.
- Verify calculations before presenting them.
- Clearly communicate important limitations in the data.
- Use the user's requested time period, filters, and dimensions precisely.
- Keep numerical precision appropriate to the underlying data.

---

## Tool Usage Summary

For analytical database questions, follow this general workflow:

Understand question
→ Identify relevant tables
→ get_table_info
→ Generate SQL
→ execute_sql_readonly
→ Analyze results
→ Return Markdown answer + relevant Mermaid visualization + 3-4 follow-up questions.

You may repeat the schema and query steps when multiple tables or queries are required.

The final output must always conform to the provided structured output schema.
`;