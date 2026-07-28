# Ally — Data Schema Reference

> **Purpose:** A single map of *what data exists* and *where it lives* across the Ally
> platform, so features and analytics can be built without re-reading every entity file.
>
> **Scope:** This document is descriptive, not authoritative. The source of truth is always
> the code — TypeORM entities in `src/**/entity/*.entity.ts` and Weaviate collection
> definitions in `ally-ai/app/core/vector_db/constants.py`. When they disagree, the code wins;
> please update this file when you change a schema.
>
> **Repos:** Paths beginning `src/` are in **this repo** (`ally-be`). Paths beginning `ally-ai/`
> live in the separate **`ally-ai`** repository (`HelloAllyTech/ally-ai`), checked out alongside
> this one in the workspace.
>
> Last reconciled with the codebase: **2026-06-12**.

---

## 1. Data stores at a glance

| Store | Tech | Owned by | Holds | Where defined |
|-------|------|----------|-------|---------------|
| **Primary relational DB** | PostgreSQL (TypeORM) | `ally-be` | All transactional/business data — users, tenants, scenarios, sessions, chats, cases, reviews, badges, prompts, analytics config, audit logs (121 tables) | `src/**/entity/*.entity.ts` |
| **Vector DB** | Weaviate | `ally-ai` | Embedded conversation turns + reference documents for semantic search / RAG | `ally-ai/app/core/vector_db/constants.py` |
| **Cache / ephemeral** | Redis (`ioredis`) | `ally-be` | Caching, rate-limit counters, transient session/room state | `src/redis/` |
| **Message queue** | AWS SQS | `ally-be` ↔ `ally-ai` | Async jobs — transcription & summarization results, cross-service events | `src/message-broker/` |
| **Object storage** | AWS S3 | `ally-be` / `ally-ai` | Session/call recordings, uploaded audio, cover images, reference doc files | AWS SDK; keys stored on entities (`storageKey`, `*Url`) |
| **Real-time media** | LiveKit | `ally-be` + `ally-ai` agent | Live audio/video rooms; egress writes recordings to S3 | `src/livekit/` |

**Service topology:** `ally-be` (NestJS API, owns Postgres) ⇄ `ally-ai` (Python FastAPI, owns
Weaviate, runs the conversational AI agent) ⇄ `ally-web` / `ally-mobile` (clients). SQS and
LiveKit bridge the two backends.

---

## 2. PostgreSQL conventions (read this first)

These apply to nearly every table, so they are stated once here and not repeated per-table.

- **Naming:** Classes are PascalCase; table & column names are `snake_case`
  (e.g. `tenantId` → `tenant_id`). Table name comes from `@Entity('...')`; a few legacy tables
  fall back to the class name (noted inline).
- **Base classes** (`src/common/entity/`):
  - `BaseEntity` → adds `created_at`, `updated_at`, **`tenant_id`** (tenant-scoped data).
  - `BaseWithoutTenantEntity` → adds `created_at`, `updated_at` only (global/shared data).
  - A few tables define their own timestamps or extend none.
- **Multi-tenancy:** `tenant_id` on tenant-scoped tables isolates org data. Globally-authored
  content (scenarios, cases, paths, badges, dashboards) is *shared* and made visible to tenants
  through explicit join tables: `*_tenants` (e.g. `scenario_tenants`, `case_tenants`,
  `badge_tenants`, `dashboard_tenants`) and to user groups via `*_groups`.
- **Soft deletes:** Many tables use a nullable `deleted_at` instead of hard deletes. Unique
  indexes are frequently partial: `... WHERE deleted_at IS NULL`. **Always filter
  `deleted_at IS NULL` in analytics queries** unless you specifically want tombstones.
- **Audit columns:** `created_by` / `updated_by` (integer user IDs) appear on most authored content.
- **i18n:** Translatable content has a sibling `*_translation(s)` table keyed by
  `(parent_id, language_id)`. `language_id` → `languages.id`.
- **JSONB:** `metadata`, `config`, `settings`, `data`, `translations` columns hold semi-structured
  data — flexible but not directly queryable without `->>`/`jsonb` operators.
- **Migrations:** TypeORM, 251+ migrations in `src/database/migrations/`. Schema is **not**
  auto-synchronized (`synchronize: false`); changes ship as migrations. Config:
  `src/database/data-source.ts`.
- **PK types vary:** Some tables use auto-increment `int` PKs (older core tables: `users`, `chats`,
  `messages`, `scenarios`), others use `uuid`. Watch the join types — e.g. `scenario_id` is `int`,
  `scenario_session_id` is `uuid`.

---

## 3. PostgreSQL tables by domain

Columns listed are the notable ones; every table also has the base-class columns from §2.
Module path = `src/<module>/entity/`.

### 3.1 Identity, tenancy & access control (`user`, `tenant`, `auth`, `authorization`, `settings`, `language`, `place`)

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `users` | BaseEntity | `id` (int PK), `email` (uniq), `username` (uniq), `phone` (uniq), `name`, `status` (`UserStatus`), `password` (select:false), `external_id`, `profile_image_url`, `metadata` (jsonb), `suspended_by/at`, `terms_*` | Unique `(tenant_id, external_id)` where not null |
| `user_preferences` | BaseEntity | `id` (uuid), `user_id` (uniq), `data` (jsonb) | One row per user |
| `admin_tenants` | BaseWithoutTenant | `user_id`, `tenant_id`, `deleted_at` | Which users administer which tenants; unique `(user_id, tenant_id)` |
| `tenants` | (custom) | `id` (uuid), `name` (uniq), `code` (uniq), `status` (`TenantStatus`: ACTIVE/INACTIVE/SUSPENDED), `metadata`, `settings` (jsonb), `logo_url`, `deleted_at` | The organization root entity |
| `refresh_token` | TypeORM base | `id` (int), `token`, `expires_at`, `user_id`, `device_info` | Auth refresh tokens |
| `groups` | (custom) | `id` (int), `name` | User groups (RBAC + content targeting) |
| `permissions` | (custom) | `id` (int), `name` | Permission catalog |
| `group_permissions` | (custom) | `group_id`, `permission_id` | Group → permission join |
| `user_groups` | (custom) | `user_id`, `group_id` | User → group join |
| `global_settings` | BaseWithoutTenant | `name` (uniq), `value` (jsonb), `created_by`, `updated_by` | Platform-wide settings |
| `preference` | BaseEntity | `name` (`PreferenceName`), `related_id`, `related_entity`, `value` (jsonb) | Generic per-entity preferences |
| `languages` | BaseWithoutTenant | `id` (int), `value` (uniq), `label`, `active`, `translation_code`, `llm_provider_config`, `stt_provider_config` (jsonb) | i18n + per-language LLM/STT config |
| `places` | (custom) | `id` (int), `city` (idx), `state` | Geo reference data |

### 3.2 Scenario authoring — the "Learn" domain (`learn`, `scenario-character`, `scenario-cover-image-library`, `scenario-path`, `session-event`)

Scenarios are the simulated-roleplay training content. They are globally authored, then shared to
tenants/groups.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `scenarios` | BaseWithoutTenant | `id` (int), `title`, `scenario`, `description`, `cover_image_url`, `cover_video_url`, `status` (`ScenarioStatus`, default DRAFT), `prompt`, `difficulty_level`, `is_global`, `is_public`, `competency_id`, `metadata`/`translations` (jsonb), `engine` (`ScenarioEngine`: `SIMULATION` default \| `ROLEPLAY_V2`), `roleplaySpecId` (uuid, loose FK → `roleplay_specs`), `category` (`ScenarioCategory`: `ORIGINALS`\|`DEMO`\|`PARTNER_SIM`\|`OTHER`, nullable), `partnerOrgName` (varchar 255, nullable free-text tag), `deleted_at` | The core training scenario. `engine=ROLEPLAY_V2` rows are thin shells materialised by Roleplay Studio v2 (§3.9) — the v1 studio rejects edits to them (422). `category`/`partnerOrgName` organise the Studio list (filterable; admin search also matches the partner tag) |
| `scenario_translations` | BaseWithoutTenant | `scenario_id`, `language_id`, `metadata` | Uniq `(scenario_id, language_id)` |
| `scenario_tenants` | BaseWithoutTenant | `scenario_id`, `tenant_id`, `deleted_at` | Scenario→tenant visibility |
| `scenario_voices` | BaseWithoutTenant | `name`, `provider`, `config` (jsonb), `language_id`, `active` | TTS voice catalog |
| `scenario_characters` | BaseWithoutTenant | `name` (idx), `age`, `gender`, `gender_identity`, `sexual_orientation`, `profession`, `current_location`, `character_profile_text`, cover media | Simulated client personas |
| `scenario_cover_image_library` | BaseWithoutTenant | `image_url`, `created_by` | Reusable cover images |
| `behaviors` | BaseWithoutTenant | `id` (uuid), `name`, `created_by` | Skills/behaviors to demonstrate |
| `behavior_translations` | BaseWithoutTenant | `behavior_id`, `language_id`, `name` | Uniq `(behavior_id, language_id)` |
| `competencies` | BaseWithoutTenant | `id` (uuid), `name` | Higher-order skill groupings |
| `agent_test_cases` | BaseWithoutTenant (no tenant_id, no soft-delete) | `id` (uuid), `title`, `type` (`AgentTestCaseType`: `condition`\|`full_session`, default `condition`), `tags` (jsonb `string[]`), `description` (text), `condition` (text), `test` (text), `rubrics` (jsonb `[{criteria, scoringInstructions}]`), `created_by` (int) | **Global** catalog of agent/actor evaluation test cases (SUPER_DUPER_ADMIN-authored); `scenario_session_details.metrics` is scored against these. Renamed from `optimisation_goals` (migration 1810); `type`/`rubrics`/`tags` (replacing single `category`) added in 1862 |
| `filler_tags` | BaseWithoutTenant | `name` | Speech fillers ("um", "uh") catalog |
| `scenario_behavior_instructions` | BaseWithoutTenant | `scenario_id`, `category` (`BehaviorInstructionCategory`), `state_instructions` (jsonb), `deleted_at` | Per-scenario behavior detection rules |
| `scenario_behavior_instruction_behaviors` | BaseWithoutTenant | `behavior_id`, `scenario_behavior_instruction_id` | Many-to-many join |
| `scenario_behavior_instruction_translations` | BaseWithoutTenant | `scenario_behavior_instruction_id`, `language_id`, `instructions` (text[]) | |
| `scenario_events` | BaseWithoutTenant | `scenario_id`, `event_id`, `score`, `emoji`, `message`, `feedback_status`, `branching_status`, `branch_instruction`, `auto_termination_status`, `detection_config` (jsonb), `checklist_visibility_status`, `deleted_at` | Detectable in-session events per scenario |
| `scenario_events_translations` | BaseWithoutTenant | `scenario_id`, `event_id`, `language_id`, `message`, `branch_instruction` | |
| `session_events` | BaseWithoutTenant | `id` (varchar PK), `name`, `event_code` (uniq), `detection_type` (`SessionEventDetectionType`), `visibility_type`, `detection_data`/`detection_config` (jsonb), `tags` (text[]), `score`, `emoji`, `branch_instruction`, `deleted_at` | **Global** reusable event library (vs scenario-specific `scenario_events`) |
| `session_events_translations` | BaseWithoutTenant | `session_event_id`, `language_id`, `name`, `message`, `branch_instruction`, `detection_data` | |
| `trigger_warnings` | BaseWithoutTenant | `id` (uuid), `name`, `translations` (jsonb) | Content-warning catalog |
| `scenario_trigger_warnings` | BaseWithoutTenant | `scenario_id`, `trigger_warning_id` | Join |
| `simulation_credits` | (custom) | `id` (int), `user_id` (uniq), `credit_limit`, `consumed_credits` | Per-user simulation usage quota |
| `scenario_paths` | BaseWithoutTenant | `id` (uuid), `title`, `description`, `status` (`ScenarioPathStatus`, DRAFT), `is_global`, `total_scenarios`, `translations` (jsonb), `deleted_at` | Ordered curriculum of scenarios |
| `scenario_path_items` | BaseWithoutTenant | `scenario_path_id`, `scenario_id`, `order`, `message_title/content`, `minimum_score`, `deleted_at` | A step in a path |
| `scenario_path_tenants` | BaseWithoutTenant | `scenario_path_id`, `tenant_id`, `deleted_at` | Path→tenant visibility |
| `scenario_path_sessions` | BaseWithoutTenant | `scenario_path_id`, `user_id`, `started_at`, `completed_at`, `completed_scenarios`, `deleted_at` | A user's run through a path |
| `scenario_path_session_items` | BaseWithoutTenant | `scenario_path_session_id`, `user_id`, `scenario_path_item_id`, `status` (`SessionItemStatus`, UNLOCKED) | Per-step progress |

**Track 2.0 (`track`)** — multi-component learning tracks, built alongside (not replacing) `scenario_paths`. A track holds ordered **sections**, each holding ordered **components** of type `ROLEPLAY | CASE | QUIZ | ARTICLE | VIDEO | JOURNAL`.

| Table | Base | Key columns | Notes |
|---|---|---|---|
| `tracks` | BaseWithoutTenant | `id` (uuid), `title`, `description`, `cover_image_url`, `status` (`TrackStatus`, DRAFT), `is_global`, `progression_mode` (SEQUENTIAL), `total_items`, `estimated_duration_minutes`, `translations` (jsonb), `deleted_at` | Course root |
| `track_sections` | BaseWithoutTenant | `track_id`, `title`, `order` (uniq per track), `unlock_rule` (SEQUENTIAL), `translations`, `deleted_at` | Named unit inside a track |
| `track_items` | BaseWithoutTenant | `track_id`, `track_section_id`, `type` (`TrackItemType`), `order` (uniq per section), `title`, `scenario_id` (int, ROLEPLAY), `case_id` (uuid, CASE), `content` (jsonb — quiz/article/video/journal definition), `completion_criteria` (jsonb — minScore/passScore/watchPct/minReadSeconds), `deleted_at` | Hybrid polymorphism: reference columns for DB-backed content, `content` jsonb for inline-authored |
| `track_tenants` | BaseWithoutTenant | `track_id`, `tenant_id`, `deleted_at` | Track→tenant visibility |
| `track_enrollments` | BaseWithoutTenant | `track_id`, `user_id` (uniq pair), `tenant_id`, `started_at`, `completed_at`, `completed_items`, `last_activity_at`, `deleted_at` | A learner's run through a track |
| `track_item_progress` | BaseWithoutTenant | `track_enrollment_id`, `track_item_id` (uniq pair), `user_id`, `status` (`SessionItemStatus`, LOCKED), `started_at`, `completed_at`, `score`, `attempt_count`, `case_session_id` (loose FK → `case_sessions`), `meta` (jsonb: maxWatchedPct, article read stamps), `deleted_at` | ALL rows created upfront at enrollment (first UNLOCKED, rest LOCKED); `id` is referenced by `scenario_sessions.track_item_progress_id` |
| `track_quiz_attempts` | BaseWithoutTenant | `track_item_progress_id`, `track_item_id`, `user_id`, `attempt_number`, `answers` (jsonb), `grading` (jsonb, incl. LLM feedback for open-ended), `score_pct`, `passed`, `status` (SUBMITTED\|PENDING_GRADING\|GRADED), `submitted_at`, `graded_at` | One row per quiz attempt |
| `track_journal_entries` | BaseWithoutTenant | `track_item_progress_id`, `prompt_id` (uniq pair), `track_item_id`, `user_id`, `response` (text), `submitted_at` (null = draft) | One row per journal prompt |

### 3.3 Scenario *runtime* — sessions & telemetry (`learn`)

This is where most **analytics** about training performance live.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `scenario_sessions` | BaseEntity | `id` (uuid), `room_id`, `scenario_id`, `counselor_id` (idx), `status` (`ScenarioSessionStatus`, ACTIVE), `event_status`, `started_at`, `ended_at`, `score` (float), `metadata`, `scenario_path_session_item_id`, `case_session_item_id`, `roleplaySpecVersionId` (uuid, loose FK → `roleplay_spec_versions`; set for ROLEPLAY_V2 runs, DB column only — not on the entity) | **One simulation run.** Central fact table. v2 runs use `room_id` prefix `roleplay-` |
| `scenario_session_details` | BaseEntity | `scenario_session_id` (**unique** idx since migration 1869), `call_duration` (sec), `summary` (jsonb), `metrics` (jsonb: goal→0-100), `compositeScore` (int), `evaluationMarkdown` (text), `evaluationStatus` (IN_PROGRESS/COMPLETED/FAILED), `evaluatedAt` | One row per session, DB-enforced; both writers (summary persist + evaluation webhook) upsert ON CONFLICT on `scenario_session_id`. Migration 1869 merged historic duplicate rows (concurrent session-end writers used to insert two rows, hiding feedback). Eval columns hold the goal-based actor evaluation (LLM judge over the real-session transcript, scored vs `agent_test_cases`) populated async via the session-evaluation webhook |
| `scenario_session_messages` | BaseEntity | `id` (int), `scenario_session_id` (idx), `sender_id`, `message_type` (`ScenarioSessionMessageType`), `content`, `start_seconds`, `end_seconds`, `metadata` | Voice transcript turns |
| `scenario_session_chats` | BaseEntity | `scenario_session_id`, `user_id`, `summary`, `summarized_message_count` | Text-chat thread; uniq `(session, user)` |
| `scenario_session_chat_messages` | BaseEntity | `chat_id` (idx), `sender_id` (−1 = AI), `content`, `citation_transcript_ids` (int[]) | Text-chat messages |
| `scenario_session_feedbacks` | BaseEntity | `scenario_session_id`, `rating`, `feedback`, `tags` (jsonb) | Learner's post-session rating |
| `scenario_session_recording` | BaseEntity | `scenario_session_id` (uniq), `storage_key` (S3), `egress_id` (LiveKit) | Recording pointer |
| `scenario_session_events` | BaseEntity | `scenario_session_id` (idx), `event_id`, `occurred_at`, `score`, `emoji`, `message`, `auto_termination_status`, `metadata` | Events that fired during a run |
| `scenario_session_turn_metrics` | BaseEntity | `scenario_session_id`/`room_id`, `turn_index`, **`response_latency_ms`**, `eou_delay_ms`, `llm_ttft_ms`, `tts_ttfb_ms`, `orchestration_ms`, `llm_response_ms`, `prosody_ms` _(deprecated — no longer populated)_, `branching_ms`, `knowledge_retrieval_ms`, `process_events_ms`, `behaviors_ms`, `llm_model`, `language`, `env`, `events_detected`, `prosody_skipped` _(deprecated — no longer populated)_, `interrupted`, `llm_timed_out`, `occurred_at` | **Per-turn latency telemetry** — wide table built for Metabase percentile dashboards. Indexed on `scenario_session_id`, `occurred_at`, `scenario_id`. `prosody_ms`/`prosody_skipped` are retained for backward-compat but no longer written (speech prosody was removed). |
| `scenario_session_start_metrics` | BaseEntity | `scenario_session_id`/`room_id`, **`start_latency_ms`**, `configure_ms`, `initialize_ms`, `connect_ms`, `prep_ms`, `opening_playout_ms`, `scenario_id`, `language`, `env`, `occurred_at`, `source` (`pipeline` \| `transcript`) | **Per-session start latency ("time to first word")** — one row per simulation for the start-latency analytics chart. `start_latency_ms` = agent job start → the agent begins its opening dialogue = sum of the four segment columns (live `pipeline` rows). Backfilled `transcript` rows carry the total only (segments NULL; first agent message's `startSeconds`, excludes pre-join configure/initialize). Populated from the ally-ai-learn `start_metrics` SQS message (`StartMetricsProcessor`). Indexed on `scenario_session_id`, `occurred_at`, `scenario_id`. |
| `scenario_session_tags` | BaseWithoutTenant | `id` (uuid), `label` (uniq) | Tag catalog |
| `scenario_session_message_tags` | BaseEntity | `scenario_session_id`, `message_id`, `tag_id`, `category` (`ScenarioSessionTagCategory`) | Message↔tag join |
| `scenario_session_reflection_prompt_response` | BaseEntity | `scenario_session_id`, `prompt_id`, `response` | Reflection answers |
| `scenario_session_behavior_instructions` | BaseWithoutTenant | `scenario_session_id` (idx), `scenario_behavior_instruction_id`, `occurred_at` | Which behavior instructions triggered |
| `learn_room_metadata` | BaseWithoutTenant | `roomName` (PK, `ss_*`/`preview-*`), `payload` (jsonb), `createdAt` (idx) | **Short-lived working data, not analytics.** Full room-metadata envelope per LiveKit room, stored at session start when `LEARN_METADATA_FETCH_ENABLED`; the voice agent fetches it via the api-key webhook (`GET /v1/learn/webhook/room-metadata/:roomName`) so LiveKit room/dispatch metadata stays a tiny pointer. Rows swept after 24h |

### 3.4 Scenario reports (`scenario-report`)

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `scenario_reports` | BaseWithoutTenant | `scenario_id` (idx), `status` (`ScenarioReportStatus`, STARTED), `config`/`metrics`/`metadata` (jsonb), `report_markdown`, `ended_at`, `deleted_at` | Generated post-analysis report (job + result) |
| `scenario_report_transcripts` | BaseWithoutTenant | `scenario_report_id` (idx), `content`, `start_seconds`, `role`, `deleted_at` | Transcript lines feeding a report |

### 3.5 Live chat, calls & cases (`chat`, `case`, `audio`, `audio-ingest`, `custom-fields`, `queue`)

This is the *real client interaction* side (counselor ⇄ help-seeker), distinct from training simulations.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `chats` | BaseEntity | `id` (int), `client_id`, `counselor_id`, `status` (`ChatStatus`: STARTED/ACTIVE/ENDED/PAUSED/CANCELLED), `started_at`, `ended_at`, `external_id`, `summary_status` (`ChatSummaryStatus`), `archived_at`, `metadata` | A live chat/call session |
| `messages` | BaseEntity | `id` (int), `chat_id`, `sender_id`, `type` (`MessageType`: TEXT/SYSTEM/NUDGE/STAGE), `content`, `context`, `parent_message_id`, `start_seconds`, `end_seconds`, `metadata` | Messages in a chat |
| `feedback` | BaseEntity | `feedback_id` (int PK), `message_id` (idx), `user_id` (idx), `rating` (float), `modified_content` | Per-message feedback |
| `summary_feedback` | BaseEntity | `chat_id` (uniq), `rating` (int), `feedback` (jsonb `{issues?, comment?}`) | Feedback on a chat's summary |
| `call_details` | BaseEntity | `chat_id` (idx), `call_duration`, `start/end_time`, `no_of_nudges`, `no_of_stages`, `transcript` (text), `summary` (jsonb), `call_outcome`, `call_info` (jsonb) | Call-level rollup & transcript |
| `cases` | BaseWithoutTenant | `id` (uuid), `title`, `description`, `cover_image_url`, `status` (`CaseStatus`), `is_global`, `total_scenarios`, `translations`, `deleted_at` | A training/assessment case (bundle of scenarios) |
| `case_items` | BaseWithoutTenant | `case_id`, `scenario_id`, `order`, `message_title/content`, `minimum_score`, `deleted_at` | Scenario within a case |
| `case_sessions` | BaseWithoutTenant | `case_id`, `user_id`, `started_at`, `completed_at`, `completed_scenarios`, `deleted_at` | User's progress through a case |
| `case_session_items` | BaseWithoutTenant | `case_session_id`, `user_id`, `case_item_id`, `status` (`SessionItemStatus`), `deleted_at` | Per-item progress |
| `case_tenants` | BaseWithoutTenant | `case_id`, `tenant_id`, `deleted_at` | Case→tenant visibility |
| `chat_audio_uploads` | BaseEntity | `chat_id`, `storage_key` (S3), `status` (pending/success/failed), `sample_rate`, `format` | Uploaded call audio |
| `cloud_telephony_integrations` | BaseEntity | `provider` (`CloudTelephonyProvider`), `credentials` (jsonb), `status`, `code` (uniq), `config` (jsonb) | Telephony provider connections |
| `custom_field_definitions` | BaseEntity | `name`, `field_type` (SINGLE_SELECT/MULTI_SELECT/DATE/TEXT/NUMBER/BOOLEAN), `options` (jsonb), `section_key`, `edit_permission`, `fill_mode` (MANUAL/AI), `ai_instruction`, `scope`, `display_order`, `show_in_table`, `is_active` | Tenant-defined custom fields on chats |
| `chat_custom_field_values` | BaseEntity | `chat_id`, `field_definition_id` (FK, ON DELETE CASCADE), `value`, `updated_by` | Values; uniq `(chat_id, field_definition_id)` |
| `queue_entries` | BaseEntity | `entry_id` (int PK), `user_id` (client), `chat_id`, `priority`, `wait_start_time`, `status` (`QueueStatus`) | Client waiting queue for counselor assignment |

### 3.6 Review subsystems (`review`, `scenario-session-review`, `scribe-session-review`)

Three structurally-parallel comment/review systems sharing the abstract bases in `review/entity/`
(`BaseReview`, `BaseReviewThread`, `BaseReviewComment`, `BaseReviewCommentReaction`,
`BaseReviewReaction`, `BaseReviewReadStatus`). The two concrete subsystems differ only in what the
review points at:

- **`scenario_session_reviews`** → `scenario_session_id` (uuid) — reviews of training sessions.
- **`scribe_session_reviews`** → `scribe_session_id` (int) — reviews of scribe/note sessions.

Each subsystem has the full set of tables: `*_reviews` (`status`: HIDDEN/IN_REVIEW, `note`,
`created_by`), `*_review_threads` (`review_id`, `message_id`, `selection` jsonb, `deleted_at`),
`*_review_comments` (`review_thread_id`, `content`, `parent_comment_id`, `hidden`, `deleted_at`),
`*_review_comment_reactions`, `*_review_reactions` (`reaction`, `created_by`), and
`*_review_read_status` (`user_id`, `review_id`, `read_at`; uniq `(user_id, review_id)`). All extend
`BaseEntity` (tenant-scoped) except read-status which carries only `created_at`.

### 3.7 Engagement — community & badges (`community`, `badge`)

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `user_daily_scores` | BaseEntity | `user_id`, `date`, `minutes_played` (dec), `total_score` (dec) | Daily engagement rollup. Uniq `(user_id, tenant_id, date)`; idx `(tenant_id, date)` — **prime analytics source for activity** |
| `badges` | BaseWithoutTenant | `name`, `description`, `image_url`, `status` (DRAFT/ACTIVE), `visibility_type` (PUBLIC/PRIVATE), `category` (SIMULATION_MINUTES / ACTIVE_DAY_STREAK / COMMENTS_REACTIONS_GIVEN / COMMENTS_REACTIONS_RECEIVED), `achievement_params` (jsonb), `translations`, `deleted_at` | Badge definitions |
| `badge_groups` | BaseWithoutTenant | `badge_id`, `group_id`, `deleted_at` | Badge→group targeting |
| `badge_tenants` | BaseEntity | `badge_id`, `tenant_id`, `deleted_at` | Badge→tenant visibility |
| `badge_users` | BaseWithoutTenant | `user_id`, `badge_id`, `viewed_status` (VIEWED/UNVIEWED), `deleted_at` | Earned badges; uniq `(user_id, badge_id)` |

### 3.8 Analytics, prompts, content & platform ops (`analytics`, `prompt`, `audit`, `reference-document`, `conversational-guardrails`, `tooltip`)

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `dashboards` | BaseWithoutTenant | `external_id` (uniq, Metabase id), `name`, `description`, `data` (jsonb `DashboardMetadata`), `analytics_type` (`AnalyticsTypeEnum`), `deleted_at` | **Current** analytics dashboard registry |
| `dashboard` | BaseEntity | `id` (int), `external_id`, `name`, `order`, `group_id`, `data` (jsonb) | **Legacy** dashboard table — slated for removal (~2026-03-10). Prefer `dashboards` |
| `dashboard_groups` | BaseWithoutTenant | `dashboard_id`, `group_id`, `deleted_at` | Dashboard→group; uniq where not deleted |
| `dashboard_tenants` | BaseWithoutTenant | `dashboard_id`, `tenant_id`, `deleted_at` | Dashboard→tenant; uniq where not deleted |
| `prompts` | BaseWithoutTenant | `prompt_code` (uniq), `name` (uniq), `description`, `category`, `current_version`, `default_prompt`, `kind` (prompt/block), `prompt_type` (idx, e.g. main_agent/branching), `has_states`, `use_dashboard_override`, `is_obsolete`, `available_variables` (jsonb), `uses_blocks` (jsonb) | LLM prompt registry for the agent pipeline |
| `prompts_versions` | BaseWithoutTenant | `prompt_id` (idx), `version`, `prompt` (text), `created_by`, `updated_by` | Prompt version history; uniq `(prompt_id, version)` |
| `audit_logs` | (custom) | `id` (uuid), `event_type`, `user_id`, `tenant_id`, `details` (jsonb), `ip_address`, `user_agent`, `logged_at` | Immutable audit/compliance log |
| `reference_documents` | BaseWithoutTenant | `heading`, `content`, `category`, `tags` (text[]), `created_by`, `is_public`, `organization_id`, `is_archived`, `archived_at`, `upload_status` (pending/success/failed) | Knowledge-base docs — **mirrored into Weaviate** (see §4) for RAG |
| `conversational_guardrails` | BaseWithoutTenant | `name`, `helper_dialogue`, `actor_dialogue`, `active` | Conversation safety rules |
| `conversational_guardrails_translations` | BaseWithoutTenant | `guardrail_id`, `language_id`, `helper_dialogue`, `actor_dialogue` | Uniq `(guardrail_id, language_id)` |
| `tooltips` | BaseWithoutTenant | `location` (uniq), `tip_text`, `icon`, `active`, `created_by`, `updated_by` | Contextual UI tooltips |
| `tooltip_translations` | (custom) | `tooltip_id`, `language_id`, `tip_text` | Uniq `(tooltip_id, language_id)` |
| `blogs` | BaseWithoutTenant | `id` (uuid), `title`, `slug` (uniq where not deleted), `tldr`, `body` (text, sanitized HTML), `tags` (jsonb string[]), `category`, `header_image_url`, `status` (`BlogStatus`: DRAFT/PUBLISHED, default DRAFT), `published_at`, `created_by`, `updated_by`, `deleted_at` | Platform-wide blog (release announcements & product updates). Super-admin authored (perms `view:blogs`/`edit:blog`/`delete:blog`); **published** rows served ungated at `/api/v1/blog/public` and rendered on app.helloally.ai/blog |

### 3.9 Roleplay Studio v2 (`roleplay-studio`)

The spec-driven successor to the v1 scenario studio: an AI copilot interviews the trainer and
builds a versioned **spec document** (jsonb, schema `"1.0"`: persona, 3-6-state machine,
disclosure ledger, rubric, engineered events, voice/language, models). Publishing a version
materialises a thin `scenarios` row (`engine=ROLEPLAY_V2`) so learner listing/launch reuse the
existing pipeline; at runtime a dedicated LiveKit agent (`AgentV2`, rooms `roleplay-<uuid>`)
receives the compiled spec (inline under 55KB, else via the api-key-guarded spec-fetch webhook)
and its director reports telemetry back over the learn SQS queue.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `roleplay_specs` | BaseWithoutTenant | `id` (uuid), `title`, `status` (`RoleplaySpecStatus`: DRAFT/PUBLISHED/ARCHIVED), `competency_id`, `scenarioId` (int, loose FK → `scenarios`, created DRAFT at spec creation), `draftSpec` (jsonb — the mutable working document), `publishedVersionId` (uuid), `created_by`/`updated_by`, `deleted_at` | Authoring root; the row's `updated_at` is the optimistic-concurrency token for `PUT /specs/:id/draft` (mismatch → 409) |
| `roleplay_spec_versions` | BaseWithoutTenant | `specId` (idx), `versionNumber` (uniq per spec, monotonic), `spec` (jsonb snapshot), `status` (DRAFT/PUBLISHED/ARCHIVED — one PUBLISHED per spec), `source` (`manual_edit`/`copilot_patch`/`snapshot`), `patchId` (uuid, for copilot patches), `publishedAt`, `deleted_at` | Append-only immutable snapshots — one per draft mutation, so copilot SSE frames and room metadata always reference a stable `specVersionId` |
| `roleplay_spec_tenants` | BaseWithoutTenant | `specId`, `tenant_id`, `deleted_at`; uniq `(specId, tenantId)` where not deleted | Spec→tenant visibility; copied into `scenario_tenants` on publish |
| `copilot_sessions` | BaseWithoutTenant | `specId` (idx), `status` (ACTIVE/ENDED), `lastMessageSeq` (atomic per-session message counter), `metadata`, `created_by`/`updated_by`, `deleted_at` | One copilot conversation over a spec |
| `copilot_messages` | BaseWithoutTenant | `sessionId`, `seq` (uniq `(sessionId, seq)`, gapless), `role` (user/assistant), `content` (text), `toolCalls`/`toolResults`/`specDiff`/`metadata` (jsonb), `created_by` | **Append-only** transcript (no soft delete); `specDiff` records the RFC-6902 patches applied during the turn (patches survive aborted turns) |
| `roleplay_director_events` | BaseWithoutTenant | `scenarioSessionId` (idx, loose FK), `roomId` (idx), `eventType` (`director_state_transition`/`director_rubric_score`/`director_disclosure_unlock`/`director_stage_direction`/`roleplay_session_summary` — the SQS `message_type` strings), `turnIndex`, `payload` (jsonb, raw message data), `occurredAt` | **Append-only** director telemetry, one row per SQS message; sessions resolved by `room_id`, unknown rooms skipped |
| `roleplay_rubric_scores` | BaseWithoutTenant | `scenarioSessionId` (idx), `roomId` (idx), `turnIndex`, `behaviorId` (rubric behavior id from the spec doc, not `behaviors`), `score` (float), `rationale` (text), `occurredAt` | Per-(turn, behavior) flattening of `director_rubric_score` messages for cheap aggregation |

### 3.10 AI Lab (`lab`)

A super-duper-admin workspace (admin tab **AI Lab**) for authoring reusable system-prompt
templates (**skills**), the placeholder **variables** they reference as `{{name}}`, and the
candidate **values** bound to those variables (substituted at run time). System-wide (no tenant);
gated by perms `view:admin:ai-lab` / `edit:admin:ai-lab` / `delete:admin:ai-lab`, granted to both
the `SUPER_ADMIN` and `SUPER_DUPER_ADMIN` groups. The "Runs" surface is not built yet. Added in
migrations `1844000000000` (tables) / `1844000000001` (permissions).

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `lab_skills` | BaseWithoutTenant | `id` (uuid), `name` (idx), `description` (nullable), `content` (text — the system-prompt template, may embed `{{variable}}` placeholders), `created_by` | Reusable system-prompt templates |
| `lab_variables` | BaseWithoutTenant | `id` (uuid), `name` (varchar(255), **uniq** — referenced in templates as `{{name}}`), `description` (nullable), `created_by` | Named template placeholders; name charset restricted to `[A-Za-z0-9_.-]` |
| `lab_values` | BaseWithoutTenant | `id` (uuid), `variable_id` (uuid, idx, **FK → `lab_variables` ON DELETE CASCADE**), `label` (nullable), `value` (text), `created_by` | Candidate values bound to a variable; deleting the parent variable cascades to its values |

---

## 4. Weaviate (vector DB — `ally-ai`)

Defined in `ally-ai/app/core/vector_db/constants.py`; migrations in `ally-ai/app/migrations/`.
Each "collection" stores objects + their embeddings for semantic search / RAG.

| Collection | Properties | Purpose |
|------------|------------|---------|
| `Conversation` | `chat_id` (int), `message` (text), `role` (text), `timestamp` (date) | Embedded conversation turns for semantic recall within the AI agent. Mirrors a subset of Postgres `messages`/session messages, keyed by `chat_id` |
| `ReferenceDocument` | `heading` (text), `content` (text), `category` (text), `tags` (text[]), `tenant_id` (text) | Embedded knowledge-base docs for RAG. Mirror of Postgres `reference_documents`, scoped by `tenant_id` |
| `MigrationHistory` | `version`, `name`, `description`, `status`, `created_at`, `completed_at` | Internal — tracks applied Weaviate migrations |

**Cross-store link:** `Conversation.chat_id` ↔ `chats.id`; `ReferenceDocument` ↔ `reference_documents`
(by content/tenant). There is no DB-enforced FK across stores — consistency is application-managed.

---

## 5. Other stores

- **Redis** (`src/redis/`): caching, rate-limit counters (`src/rate-limit/`), and transient
  session/room coordination. Not a system of record — treat as disposable.
- **AWS SQS** (`src/message-broker/`): async pipeline between `ally-be` and `ally-ai`.
  Notably carries transcription + summarization results
  (`QUEUE__TRANSCRIBE_AND_SUMMARIZE_RESULTS_BUCKET`).
- **AWS S3**: binary assets. Object keys are stored on Postgres rows — `storage_key`
  (`scenario_session_recording`, `chat_audio_uploads`) and `*_url` columns (cover images, profile
  images, logos). To find a file, read the key/URL off the owning row.
- **LiveKit** (`src/livekit/`): real-time audio/video rooms. `scenario_sessions.room_id`
  ties a session to its room; egress recordings land in S3 and are referenced by
  `scenario_session_recording.egress_id` + `storage_key`.

---

## 6. "Where do I find…?" quick index

| I need… | Look at |
|---------|---------|
| A user / their org | `users`, `tenants`, `admin_tenants` |
| Who can do/see what | `groups`, `permissions`, `group_permissions`, `user_groups`, `*_tenants`, `*_groups` join tables |
| A training simulation run + its score | `scenario_sessions` (+ `_details`, `_messages`, `_events`, `_feedbacks`) |
| Per-turn AI latency / performance | `scenario_session_turn_metrics` |
| A Roleplay Studio v2 spec / its versions | `roleplay_specs`, `roleplay_spec_versions`, `roleplay_spec_tenants` |
| Copilot spec-authoring conversations | `copilot_sessions`, `copilot_messages` |
| v2 director telemetry (state path, unlocks, rubric) | `roleplay_director_events`, `roleplay_rubric_scores` |
| Simulation start latency (time to first word) | `scenario_session_start_metrics` |
| Learner progress through curriculum | `scenario_path_sessions` / `_items`, `case_sessions` / `_items` |
| A real client chat/call + transcript | `chats`, `messages`, `call_details` |
| Daily activity / engagement for analytics | `user_daily_scores`, `badge_users` |
| Analytics dashboard config | `dashboards` (current), `dashboard` (legacy) |
| LLM prompts driving the agent | `prompts`, `prompts_versions` (Postgres); guardrails in `conversational_guardrails` |
| AI Lab skills / variables / values | `lab_skills`, `lab_variables`, `lab_values` |
| Semantic search / RAG content | Weaviate `Conversation`, `ReferenceDocument` |
| A recording or uploaded audio file | `scenario_session_recording`, `chat_audio_uploads` → S3 key |
| Compliance / who-changed-what | `audit_logs`, plus `created_by`/`updated_by` on entities |

---

## 7. Maintaining this document

- Edit when you add/rename a table, column, enum, or Weaviate collection.
- Source files: `src/**/entity/*.entity.ts`, `src/database/migrations/`,
  `ally-ai/app/core/vector_db/constants.py`, `ally-ai/app/migrations/`.
- Quick entity census: `find src -name '*.entity.ts' | wc -l`
  (was **120** at last reconcile — includes the 9 Roleplay Studio v2 entities).
