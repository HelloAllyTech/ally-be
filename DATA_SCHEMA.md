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
| `groups` | (custom) | `id` (int), `name` | User groups (RBAC + content targeting). `name` holds a `UserRole` value for ten RBAC roles: `CLIENT`, `COUNSELOR`, `ADMIN`, `LEARNER`, `SIMULATION_REVIEWER`, `SCRIBE_REVIEWER`, `MULTI_TENANT_ADMIN`, `SUPER_ADMIN`, `SUPER_DUPER_ADMIN`, `PLATFORM_ADMIN`. (An earlier tenth, `INTERNAL`, was added by migration `1878000000000` and removed again by `1885000000000` along with the `/admin` console surface it existed for.) `PLATFORM_ADMIN` (migration `1895000000001`) is the single consolidated platform-tier role replacing `SUPER_ADMIN`/`SUPER_DUPER_ADMIN`/`MULTI_TENANT_ADMIN` — those three groups and their `user_groups`/`group_permissions` rows are kept, unreferenced by new code, for rollback safety during the rollout window; a later cleanup migration removes them. `PLATFORM_ADMIN`'s `group_permissions` is the union of all three (in practice, identical to `SUPER_DUPER_ADMIN`'s — verified to already be a superset). No unique constraint on `name`, so inserts guard with `NOT EXISTS` |
| `permissions` | (custom) | `id` (int), `name` | Permission catalog |
| `group_permissions` | (custom) | `group_id`, `permission_id` | Group → permission join |
| `user_groups` | (custom) | `user_id`, `group_id`, `createdAt`, `updatedAt` | User → group join. `createdAt` (present since `1745471638067`, `NOT NULL DEFAULT now()`) is **when the role was granted** — the only stored answer to "when did this person get admin access?", surfaced as `roleGrantedAt` by `UserRepository.getUsersWithRole` and rendered as the Ally admins screen's "Added on". Don't substitute `users.created_at` for it; that is the account's birthday and reads years early for anyone who used Ally before being promoted. Rows written by a migration (the tier collapse `1895000000001`, the one-off promote migrations) are stamped with the migration's run time; `1901000000000` pulls each PLATFORM_ADMIN row back to the earliest of that user's retired-tier rows so the rollout date doesn't masquerade as everyone's grant date. UI grants are exact |
| `admin_feature_toggles` | BaseWithoutTenant | `id` (uuid), `user_id`, `feature_key`, `enabled`, `updated_by` (nullable) | Per-platform-admin-user feature toggles — the fine-grained replacement for the old SUPER_ADMIN/SUPER_DUPER_ADMIN/MULTI_TENANT_ADMIN tier split (migration `1895000000000`). One row per `(user_id, feature_key)`; a missing row means disabled (`FeatureToggleGuard` fails closed). Registry of valid keys: `src/authorization/constants/admin-feature-toggle.constants.ts`. Editable only by users holding the `admin_user_management` toggle |
| `global_settings` | BaseWithoutTenant | `name` (uniq), `value` (jsonb), `created_by`, `updated_by` | Platform-wide settings |
| `preference` | BaseEntity | `name` (`PreferenceName`), `related_id`, `related_entity`, `value` (jsonb) | Generic per-entity preferences |
| `languages` | BaseWithoutTenant | `id` (int), `value` (uniq), `label`, `active`, `translation_code`, `llm_provider_config`, `stt_provider_config` (jsonb) | i18n + per-language LLM/STT config |
| `language_variety_profiles` | BaseWithoutTenant | `language_id`, `name`, `description`, `status` (`inferred`/`confirmed`/`archived`), `features` (jsonb: code-mix, address forms, discourse markers, characteristic lexemes), `exemplars` (jsonb string[]), `source` (jsonb inference provenance), `version` | How one deployment population speaks a language, inferred from learner-side judged transcripts. Shared entities — tenants attach many-to-one. v1: inference + storage only, nothing reads them at runtime |
| `variety_profile_attachments` | BaseWithoutTenant | `profile_id` → `language_variety_profiles`, `tenant_id` (varchar), `language_id`, `attached_by` (`inferred`/`manual`), `similarity` (float, nullable); unique (`tenant_id`,`language_id`) | Tenant→profile mapping: one active attachment per tenant per language; re-inference re-points the row |
| `language_glossary_sections` | BaseWithoutTenant | `language_id` → `languages`, `section_code`, `profileId` (uuid nullable → `language_variety_profiles`; NULL = global row, non-NULL = variety-profile overlay served merged with global, overlay wins on section_code), `content` (markdown), `injection_mode` (`always`/`retrieved`; reassigned each cycle by the computed tier pass — value-per-token knapsack under the Tier 0 cap), `tierPinned` (bool: admin override, set automatically on a manual mode change; the tier pass never touches pinned rows), `status`, `version`, `entries` (jsonb proposals; each entry's `provenance` carries `annotationIds`, `tenantIds`, `batchId` and lexical `evidence` {say/avoid corpus counts, verdict}) | Per-language "how to speak X" glossary served to the live agent (Tier 0 style card / Tier 1 retrieval). Consolidation reads exclude `isTestOrganization` tenants; extraction is construct-class clustered with support + distributional-evidence gates |
| `glossary_consolidation_batches` | BaseWithoutTenant | `language_id`, `status` (`active`/`rolled_back`), `auto_accepted` (bool), `trigger` (`manual`/`scheduled`), `stats` (jsonb; incl. `engineeringFindings` — production-artifact clusters like truncated replies the consolidation prompt routes away from glossary content; their annotations count as consumed), `entries` (jsonb: sectionId/sectionCode/profileId/entryId/markdown/accepted) | One consolidation run — the unit of autonomy and undo. Rollback removes its accepted lines and rejects its entries (annotations stay consumed) |
| `glossary_adherence_reports` | BaseWithoutTenant | `scenario_session_id` (uniq) → `scenario_sessions`, `language_id` → `languages`, `glossary_versions` (jsonb), `total_violations`, `violations` (jsonb) | Per-session avoid-list violation scan of the agent transcript (deterministic, derived — rebuilt on re-scan) |
| `places` | (custom) | `id` (int), `city` (idx), `state` | Geo reference data |
| `tenant_cohorts` | BaseWithoutTenant | `id` (uuid), `tenantId` (uuid), `name` (varchar 120), `description`, `deletedAt` | A tenant admin's own **MECE** grouping of their users — the audience half of two-layer content targeting (layer 1 = `*_tenants`, "does this org have it"; layer 2 = these cohorts, "which of our people"). Unrelated to `groups`, which is RBAC. Unique `(tenantId, lower(name))` where live, so "Night shift" and "night shift" cannot coexist. Note the uuid `tenantId` rather than BaseEntity's snake-cased *varchar* `tenant_id`: every join this participates in is uuid-to-uuid |
| `tenant_cohort_members` | BaseWithoutTenant | `id` (uuid), `cohortId` → `tenant_cohorts` (ON DELETE CASCADE), `userId`, `tenantId` (uuid), `deletedAt` | One user's membership of one cohort. **`tenant_cohort_members_user_uq` is a partial UNIQUE on `userId` ALONE (live rows only) — that index *is* the MECE guarantee.** Do not widen it to `(userId, cohortId)`: a user in two cohorts would see the union of two restriction sets, which is exactly what this design rejects. A move soft-deletes the old row and inserts the new one in one transaction, so a concurrent double-move fails loudly instead of silently duplicating. Users with no live row are the "Unassigned" audience |
| `scenario_cohort_restrictions` | BaseWithoutTenant | `id` (uuid), `scenarioId` (int), `cohortId` (uuid, **nullable**) → `tenant_cohorts`, `tenantId` (uuid), `deletedAt` | Narrows one tenant-assigned scenario to specific cohorts. **Rows only ever subtract: no rows means visible to the whole tenant**, which is why cohorts shipped with no backfill and change nothing for a tenant that never uses them. A NULL `cohortId` targets the Unassigned audience — chosen over a per-tenant system cohort row because NULL cannot go missing for a new tenant. That nullability costs *two* partial unique indexes per table (`_cohort_uq` for non-NULL, `_unassigned_uq` for NULL), since Postgres treats NULLs as distinct and a plain UNIQUE would accept duplicate "unassigned" rows |
| `track_cohort_restrictions` | BaseWithoutTenant | `id` (uuid), `trackId` (uuid), `cohortId` (uuid, nullable), `tenantId` (uuid), `deletedAt` | As above, for courses. Three separate tables rather than one polymorphic `contentId varchar` because `scenarios.id` is an **integer** while `tracks.id`/`cases.id` are uuids — one table would force a cast on every join in the three hottest learner queries |
| `case_cohort_restrictions` | BaseWithoutTenant | `id` (uuid), `caseId` (uuid), `cohortId` (uuid, nullable), `tenantId` (uuid), `deletedAt` | As above, for cases |

### 3.2 Scenario authoring — the "Learn" domain (`learn`, `scenario-character`, `scenario-cover-image-library`, `scenario-path`, `session-event`)

Scenarios are the simulated-roleplay training content. They are globally authored, then shared to
tenants/groups.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `scenarios` | BaseWithoutTenant | `id` (int), `title`, `scenario`, `description`, `cover_image_url`, `cover_video_url`, `status` (`ScenarioStatus`, default DRAFT), `prompt`, `difficulty_level`, `is_global`, `is_public`, `competency_id`, `metadata`/`translations` (jsonb), `engine` (`ScenarioEngine`: `SIMULATION` — single-valued since §3.9 was removed), `roleplaySpecId` (uuid, vestigial, always null), `category` (`ScenarioCategory`: `ORIGINALS`\|`DEMO`\|`PARTNER_SIM`\|`OTHER`, nullable), `partnerOrgName` (varchar 255, nullable free-text tag), `deleted_at` | The core training scenario. `category`/`partnerOrgName` organise the Studio list (filterable; admin search also matches the partner tag) |
| `scenario_translations` | BaseWithoutTenant | `scenario_id`, `language_id`, `metadata` | Uniq `(scenario_id, language_id)` |
| `scenario_tenants` | BaseWithoutTenant | `scenario_id`, `tenant_id`, `deleted_at` | Scenario→tenant visibility |
| `scenario_voices` | BaseWithoutTenant | `name`, `provider`, `config` (jsonb), `language_id`, `active` | TTS voice catalog |
| `scenario_characters` | BaseWithoutTenant | `name` (idx), `age`, `gender`, `gender_identity`, `sexual_orientation`, `profession`, `current_location`, `character_profile_text`, cover media, `voice_id` (uuid, loose FK → `scenario_voices.id`), `language_characteristics`, `linguistic_style_samples` (jsonb string[]), `knowledge_sources` (jsonb `{id,title,text}[]`), `tenant_id` (idx, **nullable**) | Simulated client personas. Not FK-linked to `scenarios` — Studio v1 still duplicates persona fields onto scenario metadata rather than referencing this table. `tenant_id IS NULL` means Ally-owned/global (every row predating the tenant-scoped library); a non-null value is a character a tenant's own ADMIN created, visible only inside that tenant. Platform admins (SYSTEM_ACCESS) see every row; everyone else is filtered to their own `tenant_id`. Not `BaseEntity`, whose `tenant_id` is NOT NULL — the global rows need NULL |
| `scenario_cover_image_library` | BaseWithoutTenant | `image_url`, `created_by` | Reusable cover images |
| `character_interview_sessions` | BaseWithoutTenant | `status` (ACTIVE/COMPLETED), `lastMessageSeq` (atomic per-session message counter), `draftCharacter` (jsonb — the generated profile, `ScenarioCharacterRequestDto` shape), `metadata`, `tenant_id` (idx, nullable — NULL for a platform admin's interview), `createdBy` (idx)/`updatedBy`, `deletedAt` | One character-library interview-agent conversation (modeled on the retired `copilot_sessions`, §3.9). COMPLETED once the agent calls `save_character_draft`; the human reviews `draftCharacter` in the character form and saving there creates the `scenario_characters` row. `tenant_id` carries cost attribution and backs the per-tenant caps (max 5 ACTIVE, 100/calendar month) that bound LLM spend now that customer admins can run interviews; a session stays private to its creator regardless |
| `character_interview_messages` | BaseWithoutTenant | `sessionId`, `seq` (uniq `(sessionId, seq)`, gapless), `role` (user/assistant), `content` (text), `toolCalls`/`toolResults`/`metadata` (jsonb), `createdBy` | **Append-only** interview transcript (no soft delete), replayable into the Anthropic history the way the retired `copilot_messages` was |
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
| `tracks` | BaseWithoutTenant | `id` (uuid), `title`, `description`, `cover_image_url`, `status` (`TrackStatus`, DRAFT), `is_global`, `progression_mode` (SEQUENTIAL), `total_items`, `estimated_duration_minutes`, `translations` (jsonb — **legacy, no longer read or written**; superseded by `track_translations`), `deleted_at` | Course root |
| `track_sections` | BaseWithoutTenant | `track_id`, `title`, `order` (uniq per track), `unlock_rule` (SEQUENTIAL), `translations` (**legacy, never populated**), `deleted_at` | Named unit inside a track |
| `track_items` | BaseWithoutTenant | `track_id`, `track_section_id`, `type` (`TrackItemType`), `order` (uniq per section), `title`, `scenario_id` (int, ROLEPLAY), `case_id` (uuid, CASE), `content` (jsonb — quiz/article/video/journal/annotation/game definition), `completion_criteria` (jsonb — minScore/passScore/watchPct/minReadSeconds), `translations` (**legacy, never populated**), `deleted_at` | Hybrid polymorphism: reference columns for DB-backed content, `content` jsonb for inline-authored. Ids inside `content` (question/option/unit/label ids) are the anchors translations are keyed by, as well as what grading compares — never renumber them |
| `track_tenants` | BaseWithoutTenant | `track_id`, `tenant_id`, `deleted_at` | Track→tenant visibility |
| `track_enrollments` | BaseWithoutTenant | `track_id`, `user_id` (uniq pair), `tenant_id`, `started_at`, `completed_at`, `completed_items`, `last_activity_at`, `language_code` (varchar — the learner's chosen language for THIS course), `deleted_at` | A learner's run through a track. `language_code` is the **only** language grading trusts: fill-blank answers are string-compared and open-ended answers graded against a rubric, both of which are translated, so a submission is marked against this column and never a language named by the request |
| `track_item_progress` | BaseWithoutTenant | `track_enrollment_id`, `track_item_id` (uniq pair), `user_id`, `status` (`SessionItemStatus`, LOCKED), `started_at`, `completed_at`, `score`, `attempt_count`, `case_session_id` (loose FK → `case_sessions`), `meta` (jsonb: maxWatchedPct, article read stamps, GAME personal best + play count), `deleted_at` | ALL rows created upfront at enrollment (first UNLOCKED, rest LOCKED); `id` is referenced by `scenario_sessions.track_item_progress_id` |
| `track_quiz_attempts` | BaseWithoutTenant | `track_item_progress_id`, `track_item_id`, `user_id`, `attempt_number`, `answers` (jsonb), `grading` (jsonb, incl. LLM feedback for open-ended), `score_pct`, `passed`, `status` (SUBMITTED\|PENDING_GRADING\|GRADED), `submitted_at`, `graded_at` | One row per quiz attempt |
| `track_journal_entries` | BaseWithoutTenant | `track_item_progress_id`, `prompt_id` (uniq pair), `track_item_id`, `user_id`, `response` (text), `submitted_at` (null = draft) | One row per journal prompt |
| `track_annotation_attempts` | BaseWithoutTenant | `track_item_progress_id`, `track_item_id`, `user_id`, `attempt_number`, `marks` (jsonb — the (unitId,labelId) pairs the learner marked), `grading` (jsonb — full result incl. misses and author notes), `score_pct`, `passed`, `submitted_at`, `deleted_at` | One row per ANNOTATED_ARTIFACT attempt. No `status` column: grading is pure set comparison against the author's key, so it is always synchronous — nothing is ever PENDING_GRADING. Reveal gating happens on read, never by withholding data at write time |
| `track_translations` | BaseWithoutTenant | `track_id`, `language_id` (uniq pair → `languages.id`), `status` (`TrackTranslationStatus`: NOT_STARTED \| TRANSLATING \| READY_FOR_REVIEW \| PUBLISHED \| FAILED), `content` (jsonb), `published_at`, `last_job_id`, `error`, `requested_by`, `published_by` | **One language a course is available in.** A row exists as soon as the trainer selects the language, so the row set answers "which languages should this course be in?" independently of translation progress. Learners are served **only** PUBLISHED rows. `content` is `{track, sections: {sectionId: …}, items: {itemId: …}, media: {itemId: {url}}}`, where each field entry is keyed by a **stable-id path** (`content.questions[q3].options[o1].text`) and carries `{value, sourceHash, edited, reviewed, scoring, sourceChanged}` — see `track-translation-fields.util.ts`. `sourceHash` is what makes a source edit degrade one string to English rather than showing a translation of text that no longer exists; `edited` protects trainer wording from re-translation; `scoring` fields must be `reviewed` before publish. Supersedes the `translations` jsonb on `tracks`/`track_sections`/`track_items` (kept, unread) |

### 3.3 Scenario *runtime* — sessions & telemetry (`learn`)

This is where most **analytics** about training performance live.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `scenario_sessions` | BaseEntity | `id` (uuid), `room_id`, `scenario_id`, `counselor_id` (idx), `status` (`ScenarioSessionStatus`: ACTIVE \| ENDED \| ABANDONED, default ACTIVE), `event_status` (`ScenarioSessionEventStatus`: IN_PROGRESS \| COMPLETED \| ABANDONED), `abandonedReason` (varchar(64), null; `ScenarioSessionAbandonReason`), `endReason` (varchar(64), null; `ScenarioSessionEndReason` — set when an ENDED/COMPLETED session was force-exited by ally-ai-learn's stall watchdog rather than shut down cleanly), `started_at`, `ended_at`, `score` (float), `metadata`, `scenario_path_session_item_id`, `case_session_item_id`, `roleplaySpecVersionId` (uuid, vestigial — Studio v2 ran here; DB column only, not on the entity) | **One simulation run.** Central fact table. |
| `scenario_session_details` | BaseEntity | `scenario_session_id` (**unique** idx since migration 1869), `call_duration` (sec), `summary` (jsonb), `sessionMemory` (jsonb, migration 1885), `metrics` (jsonb: goal→0-100), `notApplicableGoals` (jsonb `string[]`, migration 1898), `compositeScore` (int), `evaluationMarkdown` (text), `evaluationStatus` (IN_PROGRESS/COMPLETED/FAILED), `evaluatedAt` | One row per session, DB-enforced; all three writers (summary persist + evaluation webhook + session-memory processor) upsert ON CONFLICT on `scenario_session_id`. Migration 1869 merged historic duplicate rows (concurrent session-end writers used to insert two rows, hiding feedback). Eval columns hold the goal-based actor evaluation (LLM judge over the real-session transcript, scored vs `agent_test_cases`) populated async via the session-evaluation webhook. `agent_test_cases` is a global list with no scenario scoping, so a session is scored against goals it may never have had occasion to exercise: the judge marks those in `notApplicableGoals` (titles, matching `metrics` keys) and `compositeScore` is the mean over the applicable ones only. Every goal stays in `metrics` — `notApplicableGoals` is the subset to render as N/A rather than as a low score. Null on rows judged before migration 1898, meaning "all goals applicable" (how they were in fact scored). `sessionMemory` = the agent's end-of-session rolling summary ({summary, language, messageCount, summarizedMessageCount, receivedAt}) shipped over SQS as message_type `session_memory`; `getPreviousCaseMemory` prefers it over `summary.feedback.cumulativeMemory` when building the next case session's `previousMemory`. `summary.feedback.supervisorNote` (migration-free, added with `learner_supervisor_memory`) is the learner-facing markdown debrief note written in Ally's supervisor voice; it anchors transcript moments as `[[msg:<scenario_session_messages.id>]]`, which clients resolve into links into the annotated transcript. The sibling `memory_update` ally-ai returns alongside it is deliberately NOT persisted here — it goes to `learner_supervisor_memory` and is stripped before the learner is served |
| `scenario_session_messages` | BaseEntity | `id` (int), `scenario_session_id` (idx), `sender_id`, `message_type` (`ScenarioSessionMessageType`), `content`, `start_seconds`, `end_seconds`, `metadata` | Voice transcript turns |
| `scenario_session_chats` | BaseEntity | `scenario_session_id`, `user_id`, `summary`, `summarized_message_count` | Text-chat thread; uniq `(session, user)` |
| `scenario_session_chat_messages` | BaseEntity | `chat_id` (idx), `sender_id` (−1 = AI), `content`, `citation_transcript_ids` (int[]) | Text-chat messages |
| `scenario_session_feedbacks` | BaseEntity | `scenario_session_id`, `rating`, `feedback`, `tags` (jsonb) | Learner's post-session rating |
| `learner_supervisor_memory` | BaseEntity (no soft-delete) | `id` (uuid), `counselorId` (int), `memory` (jsonb: `{focusAreas[], trajectory, nextTime, recentSessions[], totalSessions}`), `lastScenarioSessionId` (uuid), **uniq `(counselorId, tenant_id)`** (migration 1919) | What the AI supervisor carries about a **learner** between debriefs — their focus areas, how they're developing, and the one thing they were asked to try next. Do not confuse with the two *client*-side memories on `scenario_session_details`: `sessionMemory` (agent's rolling conversation summary) and `summary.feedback.cumulativeMemory` (the case's therapeutic narrative). This one follows the practitioner across every case and scenario, which is what lets a debrief open on continuity. One live row per learner per tenant, rewritten after each evaluated session — no history is kept (unbounded LLM-written text about someone's professional weaknesses is an unscoped retention liability; the shallow trail the note actually uses is `recentSessions`, capped at 5). `totalSessions` is the uncapped running count the note reports as "sessions debriefed so far" — kept separately because `recentSessions` is capped and can't answer that once a learner passes 5 sessions; rows written before this counter existed fall back to `recentSessions.length`. Written from ally-ai's `memory_update`, which is stripped from the learner-facing payload before persistence — it is the supervisor's note-to-self, not feedback |
| `scenario_session_recording` | BaseEntity | `scenario_session_id` (uniq), `storage_key` (S3), `egress_id` (LiveKit) | Recording pointer |
| `scenario_session_events` | BaseEntity | `scenario_session_id` (idx), `event_id`, `occurred_at`, `score`, `emoji`, `message`, `auto_termination_status`, `metadata` | Events that fired during a run |
| `scenario_session_turn_metrics` | BaseEntity | `scenario_session_id`/`room_id`, `turn_index`, **`response_latency_ms`**, `eou_delay_ms`, `llm_ttft_ms`, `prompt_tokens`, `cached_tokens`, `tts_ttfb_ms`, `orchestration_ms`, `llm_response_ms`, `prosody_ms` _(deprecated — no longer populated)_, `branching_ms`, `knowledge_retrieval_ms`, `process_events_ms`, `behaviors_ms`, `llm_model`, `language`, `env`, `events_detected`, `prosody_skipped` _(deprecated — no longer populated)_, `interrupted`, `llm_timed_out`, `occurred_at`, `metadata` (jsonb) | **Per-turn latency telemetry** — wide table built for Metabase percentile dashboards. Indexed on `scenario_session_id`, `occurred_at`, `scenario_id`. `prosody_ms`/`prosody_skipped` are retained for backward-compat but no longer written (speech prosody was removed). `prompt_tokens`/`cached_tokens` are the raw OpenAI prompt-cache counts for this turn's `generate_response` LLM call (null before this was instrumented, or for `transcript`-source rows) — kept as raw counts rather than a pre-computed rate so the hit-rate aggregation method (ratio-of-sums vs. average-of-ratios) stays a query-time decision; see `PlatformAnalyticsRepository.getVoiceLatencyByBucket`'s `avgCacheHitRatePct`. `interrupted` = **this turn was produced by the learner cutting the actor off** (not "this reply was truncated": the record ships when the agent starts speaking, while LiveKit reports the interruption when playback ends). It is written by the live worker and cannot be backfilled, so a zero before that deploy means *not recorded* — the Weak Performing Metrics tab drops those buckets rather than drawing them. `response_latency_ms` is time to the agent's **first audio**, which is a thinking-filler or predictive interim reply whenever one played — `metadata->>'firstAudioSource'` (`'filler'`/`'interim'`/`'reply'`; absent on `transcript` rows and on live rows predating the instrumentation) says which, and `metadata->>'replyLatencyMs'` carries the unmasked time to the real reply on masked turns. **Split by `firstAudioSource` before trending `response_latency_ms`**, or a rise in filler coverage reads as a latency improvement. `metadata` carries generation params plus **per-turn simulation state** for progression analysis, written by no other table: `stateId` (null in branching mode, which resolves no scored state), `stateIndex`, `stateCount`, `stateIsTerminal`, `stateScore`. Nothing in the app reads the state keys yet — they exist for SQL: state advanced = differs from the previous turn's, time-in-state = consecutive turns sharing one, stuck = unchanged across N turns, resolved = last turn sat in the terminal state. |
| `scenario_session_start_metrics` | BaseEntity | `scenario_session_id`/`room_id`, **`start_latency_ms`**, `configure_ms`, `initialize_ms`, `connect_ms`, `prep_ms`, `opening_playout_ms`, `scenario_id`, `language`, `env`, `occurred_at`, `source` (`pipeline` \| `transcript`) | **Per-session start latency ("time to first word")** — one row per simulation for the start-latency analytics chart. `start_latency_ms` = agent job start → the agent begins its opening dialogue = sum of the four segment columns (live `pipeline` rows). Backfilled `transcript` rows carry the total only (segments NULL; first agent message's `startSeconds`, excludes pre-join configure/initialize). Populated from the ally-ai-learn `start_metrics` SQS message (`StartMetricsProcessor`). Indexed on `scenario_session_id`, `occurred_at`, `scenario_id`. |
| `scenario_session_supervisor_notes` | BaseEntity | `scenario_session_id` (idx), `seq`, `note` (text), `turn_index`, `language`, `env`, **uniq `(scenario_session_id, seq)`** (migration 1928) | **Live supervisor notes** — the short coaching hints the AI supervisor streams into the learner's session sidebar *while the roleplay runs*, opt-in per scenario via `metadata.supervisorNotesEnabled` (default off; only an explicit `true` enables). One row per note, written from the ally-ai-learn `supervisor_note` SQS message (`SupervisorNoteProcessor`); the learner already received it over the LiveKit data channel (topic `supervisor`), so this table is the durable record, not the delivery path. `seq` is agent-assigned and 1-based per session — it is both the read order and the idempotency key, so an SQS redelivery collides on the unique index instead of showing the learner's debrief a duplicated hint. Read back at session end and passed to ally-ai as `live_notes`, which is what lets the post-session `summary.feedback.supervisorNote` say "as I mentioned during the session…". Deliberately NOT on `scenario_session_details`: notes arrive mid-session when that row may not exist, and its three upsert writers make concurrent jsonb appends a lost-update hazard. Agent-side caps (max 10 per session, min 2-turn gap) mean this table stays small per session |
| `turn_drift_judgment` | BaseEntity | `scenario_session_id` (idx), `turn_index`, `coherence`, `topic_label`, `in_character`, `counselor_utterance_garbled`, `stt_error_type`, `ai_reply_failure_mode`, `root_attribution`, `reasoning`, `user_text`/`ai_text`, `session_drifted`, `first_drift_turn`, **v2:** `roleInversion`, `offeredSolution`, `solutionsOffered`, `introducedNewInformation`, `stuckIsAppropriate`, `resistanceBriefed`, denormalised `language`/`scenario_id`/`scenario_version_id`/`llm_model`/`llm_provider`/`prompt_version`/`occurred_at`, `judge_model`, `judge_prompt_version` | **One row per AI turn, per judge run** — conversation-drift judge output. Mutable eval data, uniq `(session, turn, judgeModel, judgePromptVersion)` so a re-judge under a new rubric coexists with prior runs. The judge emits ONLY labels/booleans/counts; every rate is computed at read time, so re-weighting never means re-judging. v2 added the clienthood + progression labels for the Weak Performing Metrics tab; they are NULL on v1 rows, which is why the dashboard pins to one judge version rather than averaging across them |
| `language_judgment_sessions` | BaseEntity | `scenario_session_id`, `turns_judged`, `turns_garbled`, `dropped_annotations`, `script_fidelity_pct`, `round_trip_wer_pct`, `voice_id`/`voice_name`, denormalised slice columns, `judge_model`, `judge_prompt_version` | **Denominator row per judged session** for the language judge. A clean session has a row here and no annotations — without it, "no errors" and "never judged" would be indistinguishable |
| `language_error_annotations` | BaseEntity | `scenario_session_id` (idx), `session_judgment_id`, `turn_index`, `layer`, `dimension` (idx), `category`, `severity`, `isolation_basis`, `input_garbled`, `conditioned_out`, `evidence_quote`, `reasoning`, denormalised slice columns, `judge_model`, `judge_prompt_version` | **One row per language error.** No scalar scores: severity is a label and the 1/5/10 weights are applied at read time. Re-judging under the same version DELETEs and re-INSERTs (error sets can shrink, so upsert would leave stale rows) |
| `feedback_claim_judgment` | BaseEntity | `scenario_session_id` (idx), `claim_kind` (positive/improvement), `claim_index`, `verdict` (supported/unsupported/contradicted/misattributed, idx), `quotes_transcript`, `quote_is_accurate`, `claim_text`, `reasoning`, denormalised slice columns, `judge_model`, `judge_prompt_version` | **One row per post-session feedback claim, judged against the transcript** (migration 1903). Closes the last gap in the Weak Performing Metrics set: feedback *delivery* and score *discrimination* were measurable, whether the feedback was TRUE was not. `contradicted` on an `improvement` is the harmful case — the learner marked down for work the transcript shows them doing. Uniq `(session, claimKind, claimIndex, judgeModel, judgePromptVersion)` makes the backfill idempotent and lets rubric versions coexist |
| `scenario_session_tags` | BaseWithoutTenant | `id` (uuid), `label` (uniq) | Tag catalog |
| `scenario_session_message_tags` | BaseEntity | `scenario_session_id`, `message_id`, `tag_id`, `category` (`ScenarioSessionTagCategory`) | Message↔tag join. **Historical only.** These were the annotations drawn over the transcript; the feature was deprecated and nothing writes or reads this table any more — ally-ai stopped generating `message_tags`, and the transcript endpoint no longer joins them. Rows are kept for sessions that already had them. The seeders still populate it |
| `scenario_session_behavior_instructions` | BaseWithoutTenant | `scenario_session_id` (idx), `scenario_behavior_instruction_id`, `occurred_at` | Which behavior instructions triggered |
| `learn_room_metadata` | BaseWithoutTenant | `roomName` (PK, `ss_*`/`preview-*`), `payload` (jsonb), `createdAt` (idx) | **Short-lived working data, not analytics.** Full room-metadata envelope per LiveKit room, stored at session start when `LEARN_METADATA_FETCH_ENABLED`; the voice agent fetches it via the api-key webhook (`GET /v1/learn/webhook/room-metadata/:roomName`) so LiveKit room/dispatch metadata stays a tiny pointer. Rows swept after 24h |
| `preview_monologue_runs` | BaseWithoutTenant | `id` (PK), `roomName` (unique, `preview-*`), `scenarioId` + `createdAt` (idx), `scenarioVersionId`, `languageId`, `tenant_id`, `startedByUserId`, `turns` (jsonb), `turnCount`, `endedAt` | **The one thing an admin preview keeps.** Previews have no `scenario_sessions` row and every SQS processor drops `preview-%`, so the client's per-turn internal monologue is recorded here instead: the row is opened at preview start (who/when/which version and language) and completed when the agent's end-of-session write-out lands (`SessionMemoryProcessor` → `PreviewMonologueService`). Read back in Studio via `GET /v1/learn/scenarios/:id/preview-monologues`. At most 30 turns per run |

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
| `analytics_chart_preferences` | (custom — **no `tenant_id`**) | `id` (uuid), `userId` (int), `chartId` (varchar 128), `range` (varchar 32, nullable), `bucket` (varchar 32, nullable), `createdAt`, `updatedAt`; uniq `(userId, chartId)` (migration `1921000000000`) | Per-user, per-chart saved window and grain for the admin Analytics dashboards. The Highlights tab has no page-level date range — each chart owns its own controls — and this is what makes that choice survive a reload. **Physical columns are camelCase.** `chartId`/`range`/`bucket` are deliberately opaque varchars, not enums or FKs: the client owns the chart catalogue, so renaming or retiring a chart must not need a migration, and a stale row is ignored on read. Deliberately **not** BaseEntity — a UI preference belongs to a person, not an org, and these are platform-wide super-admin views, so a `tenant_id` would drop an admin's saved layout the moment they changed the tenant filter (same divergence as `llm_usage`) |
| `analytics_quality_thresholds` | (custom — **no `tenant_id`**) | `id` (uuid), `dimension` (varchar 64, uniq), `target` (double precision), `ceiling` (double precision), `source` (varchar 16, default `placeholder`), `sampleSize` (int, nullable), `measuredAt` (timestamp, nullable), `createdAt`, `updatedAt` (migration `1922000000000`) | 0-100 normalisation anchors for the Roleplay Quality Index (Highlights → Quality & sentiment), one row per dimension (`actorComposite`/`driftRate`/`languageErrors`/`responseLatency`). Seeded with `source='placeholder'` values so the card renders on release; `QualityThresholdCalibrationService` measures the real anchors from production traffic on an hourly scheduler tick and flips a row to `source='measured'`, which **freezes it permanently** — the write is guarded `WHERE source='placeholder'` so a re-anchor is a deliberate human edit, never an automatic recompute. Deliberately **not** BaseEntity, same divergence as `analytics_chart_preferences`: the anchors describe the platform's operating range for a platform-wide super-admin view, and a `tenant_id` would let a tenant filter silently change what a given index value means |
| `prompts` | BaseWithoutTenant | `prompt_code` (uniq), `name` (uniq), `description`, `category`, `current_version`, `default_prompt`, `kind` (prompt/block), `prompt_type` (idx, e.g. main_agent/branching), `has_states`, `use_dashboard_override`, `is_obsolete`, `visible_in_studio` (default true), `available_variables` (jsonb), `uses_blocks` (jsonb) | LLM prompt registry for the agent pipeline. `visible_in_studio=false` withdraws a variant from the studio's picker dropdowns for **new** selections only — no runtime path reads it, so scenarios already referencing the `prompt_code` keep resolving and running on it |
| `prompts_versions` | BaseWithoutTenant | `prompt_id` (idx), `version`, `prompt` (text), `created_by`, `updated_by` | Prompt version history; uniq `(prompt_id, version)` |
| `audit_logs` | (custom) | `id` (uuid), `event_type`, `user_id`, `tenant_id`, `details` (jsonb), `ip_address`, `user_agent`, `logged_at` | Immutable audit/compliance log |
| `reference_documents` | BaseWithoutTenant | `heading`, `content`, `category`, `tags` (text[]), `created_by`, `is_public`, `organization_id`, `is_archived`, `archived_at`, `upload_status` (pending/success/failed) | Knowledge-base docs — **mirrored into Weaviate** (see §4) for RAG |
| `conversational_guardrails` | BaseWithoutTenant | `name`, `helper_dialogue`, `actor_dialogue`, `active` | Conversation safety rules |
| `conversational_guardrails_translations` | BaseWithoutTenant | `guardrail_id`, `language_id`, `helper_dialogue`, `actor_dialogue` | Uniq `(guardrail_id, language_id)` |
| `tooltips` | BaseWithoutTenant | `location` (uniq), `tip_text`, `active`, `created_by`, `updated_by` | Contextual UI tooltips |
| `tooltip_translations` | (custom) | `tooltip_id`, `language_id`, `tip_text` | Uniq `(tooltip_id, language_id)` |
| `blogs` | BaseWithoutTenant | `id` (uuid), `title`, `slug` (uniq where not deleted), `tldr`, `body` (text, sanitized HTML), `tags` (jsonb string[]), `category`, `header_image_url`, `status` (`BlogStatus`: DRAFT/PUBLISHED, default DRAFT), `published_at`, `created_by`, `updated_by`, `deleted_at` | Platform-wide blog (release announcements & product updates). Super-admin authored (perms `view:blogs`/`edit:blog`/`delete:blog`); **published** rows served ungated at `/api/v1/blog/public` and rendered on app.helloally.ai/blog |
| `changelog_entries` | BaseWithoutTenant | `id` (uuid), `repo` (varchar), `releaseNoteText` (text), `mergedAt` (timestamptz, indexed `idx_changelog_entries_merged_at`) | Platform-wide changelog / release-note feed, distinct from both `blogs` and `roadmap_release_notes`. Append-only: one row per merged PR, written by the `ally-changelog` repo's `append-entry.yml` GitHub Action via `POST /api/v1/changelog` (`ApiAuthGuard`, platform `API_KEY`, not a human-authenticated route). Read publicly (no auth) via `GET /api/v1/changelog/public`, ordered `mergedAt` desc, and rendered on the helpline dashboard's `/blog/changelog` page |

**`analytics_agent_*` views.** The Analytics Agent (`src/analytics-agent/`) reads a parallel set of Postgres views, not the physical tables above, for every table that carries tenant-, session-, or user-attributable usage data (e.g. `analytics_agent_scenario_sessions`, `analytics_agent_users`, `analytics_agent_llm_usage`) — created by migration `1932000000000-CreateAnalyticsAgentTestTenantExclusionViews`. Each view is `SELECT * FROM <table> WHERE ...` pre-filtered to exclude rows belonging to a tenant flagged `tenants."isTestOrganization" = true`, mirroring `src/analytics/util/test-tenant.util.ts`'s `excludeTestTenants*` predicates but baked into the relation instead of the query, since the agent's LLM-authored SQL can take any shape. `ALLOWED_TABLES` in `analytics-agent.constants.ts` names the view, not the table, for every such entry; genuinely tenant-agnostic reference/catalog/authoring tables (e.g. `scenarios`, `tracks`, `prompts`) are left pointing at the physical table.

### 3.9 Roleplay Studio v2 — REMOVED (2026-08-31)

The spec-driven successor to the v1 scenario studio: an AI copilot interviewed the trainer and
built a versioned spec document (persona, state machine, disclosure ledger, rubric, engineered
events), which a dedicated LiveKit runtime played back with a director reporting telemetry.

It was an experiment and never left draft. Removed in migration
`1941000000000-DropRoleplayStudioV2`, which dropped all nine tables
(`roleplay_specs`, `roleplay_spec_versions`, `roleplay_spec_tenants`, `copilot_sessions`,
`copilot_messages`, `roleplay_director_events`, `roleplay_rubric_scores`, `roleplay_test_runs`,
`roleplay_test_reports`), the two `analytics_agent_roleplay_*` views over them, the two orphaned
`engine=ROLEPLAY_V2` scenario shells and the five `*:roleplay-spec*` permissions. The schemas
are still readable in migrations 1811 / 1812 / 1866.

`scenarios.engine` and `scenarios.roleplaySpecId` remain as columns — vestigial, single-valued
and always-null respectively — because dropping them means migrating a hot table for no gain.

### 3.10 AI Lab (`lab`)

A workspace (admin tab **AI Lab**) for authoring reusable system-prompt templates (**skills**),
the placeholder **variables** they reference as `{{name}}`, candidate **values** bound to those
variables (substituted at run time), **runs** (one row per skill execution), human evaluation of
published runs, and reusable **question sets**. System-wide (no tenant); gated by perms
`view:admin:ai-lab` / `edit:admin:ai-lab` / `delete:admin:ai-lab`, granted to both the
`SUPER_ADMIN` and `SUPER_DUPER_ADMIN` groups. Core tables added in migrations `1844000000000`
(tables) / `1844000000001` (permissions); human-eval tables in `1848000000000`; question sets in
`1873000000000`.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `lab_skills` | BaseWithoutTenant | `id` (uuid), `name` (idx), `description` (nullable), `content` (text — the system-prompt template, may embed `{{variable}}` placeholders), `model`/`temperature`/`max_tokens`/`system_prompt` (nullable overrides), `created_by` | Reusable system-prompt templates |
| `lab_variables` | BaseWithoutTenant | `id` (uuid), `name` (varchar(255), **uniq** — referenced in templates as `{{name}}`), `description` (nullable), `created_by` | Named template placeholders; name charset restricted to `[A-Za-z0-9_.-]` |
| `lab_values` | BaseWithoutTenant | `id` (uuid), `variable_id` (uuid, idx, **FK → `lab_variables` ON DELETE CASCADE**), `label` (nullable), `value` (text), `created_by` | Candidate values bound to a variable; deleting the parent variable cascades to its values |
| `lab_runs` | BaseWithoutTenant | `id` (uuid), `batch_id` (uuid, idx, nullable — groups rows from one "Run" click), `skill_id`/`skill_name` (name snapshotted, no FK), `resolved_prompt`, `variable_values` (jsonb snapshot), `model`, `generation_params` (jsonb), `status` (PENDING/RUNNING/COMPLETED/FAILED), `output`/`error` (nullable), token/cost columns (nullable), `published_at` (nullable — set once when published for human eval), `created_by` | One row per skill execution; snapshots content so edits/deletes of the skill don't affect history |
| `lab_eval_questions` | BaseWithoutTenant | `id` (uuid), `run_id` (uuid, idx, **FK → `lab_runs` ON DELETE CASCADE**), `question` (text), `type` (RATING/YES_NO/TEXT/DESCRIPTION — DESCRIPTION is explanatory text, never answered), `scale_min`/`scale_max` (int, RATING only), `position` (int), `source_question_set_id` (uuid, idx, nullable, **FK → `lab_question_sets` ON DELETE SET NULL** — set when imported from a question set at publish time), `created_by` | Frozen at run-publish time; a run is published at most once with ≥1 question |
| `lab_evaluators` | BaseWithoutTenant | `id` (uuid), `email` (varchar(320), **uniq**), `password_hash`, `token_version` (int), `last_login_at` (nullable), `created_by` | Standalone evaluator accounts (not platform users); sign in at `/evaluate` |
| `lab_run_assignments` | BaseWithoutTenant | `id` (uuid), `run_id`/`evaluator_id` (uuid, idx each, **uniq(run_id, evaluator_id)**, FKs ON DELETE CASCADE), `submitted_at` (nullable — flips once, then immutable), `created_by` | Published run ↔ evaluator assignment |
| `lab_eval_answers` | BaseWithoutTenant | `id` (uuid), `assignment_id`/`question_id` (uuid, **uniq(assignment_id, question_id)**, FKs ON DELETE CASCADE), `answer_text`/`answer_rating`/`answer_bool` (one populated per question type) | Written atomically with `lab_run_assignments.submitted_at` |
| `lab_auto_evaluations` | BaseWithoutTenant | `id` (uuid), `run_id` (uuid, FK), `model`, `criteria` (text), `score`/`reasoning`/`error` (nullable) | Automated LLM-judge scoring of a run's output against a rubric |
| `lab_question_sets` | BaseWithoutTenant | `id` (uuid), `name` (idx), `description` (nullable), `published_at` (nullable, one-way — locks the question list), `archived_at` (nullable, reversible — hides from the run-publish picker; only settable once published), `created_by` | Reusable, named human-eval question lists; draft while unpublished, freely editable (incl. question list) until published |
| `lab_question_set_questions` | BaseWithoutTenant | `id` (uuid), `question_set_id` (uuid, idx, **FK → `lab_question_sets` ON DELETE CASCADE**), `question`, `type` (RATING/YES_NO/TEXT/DESCRIPTION), `scale_min`/`scale_max`, `position` | Replaced wholesale while the parent set is a draft; copied (not referenced) into `lab_eval_questions` when imported at run-publish time |

---

### 3.11 WhatsApp Q&A bot & knowledge base (`whatsapp`, `knowledge-base`)

A WhatsApp number mental healthcare workers can ask questions of, answered from a vetted corpus with
passage-level citations — or declined honestly when the corpus does not cover the question. Two
modules: `knowledge-base` owns the corpus (upload → extract → chunk → index), `whatsapp` owns the
channel (webhook → dedupe → rate limit → consent → templates → retrieval → send). System-wide, no
tenant. Gated by `view|edit:knowledge-base`, `upload:knowledge-base`, `view|edit:whatsapp-bot`,
`…:templates`, `…:conversations`, `…:unanswered` and `view:whatsapp-bot:analytics`; the
`:conversations` pair is **SUPER_DUPER_ADMIN only**, because those rows hold workers' clinical
questions next to their phone numbers. Tables in migrations `1892000000000`–`1892000000002`,
permissions in `1892000000007`/`1892000000009`, seeds in `1892000000008`, tooltips in
`1892000000010`.

Three things about this domain that are not visible from the columns:

- **`kb_document_chunks.id` IS the Weaviate object UUID** (collection `KnowledgeChunk`, §4). Postgres
  is the system of record; the vector index is derived. Chunk text is immutable for a given
  `(document_id, chunk_version, chunk_index)` — an edit bumps the version, writes new rows with new
  UUIDs and deletes the old vectors, so a citation can never resolve to text that has since changed.
- **Nothing is hard-deleted.** Archiving hides a document from retrieval while its chunks stay, so
  citations already recorded in the conversation log still resolve. `DELETE /documents/:id` answers
  409 and points at archive.
- **Message bodies and phone numbers age out; counts do not.** Both the manual per-contact erasure and
  the hourly retention sweep blank `wa_messages.body`, `wa_unanswered_questions.question_text` and
  `wa_contacts.phone_e164` in place rather than deleting rows — deleting them would shrink historical
  usage figures every month as the window rolled.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `kb_documents` | BaseWithoutTenant | `id` (uuid), `title`, `source_type` (paste/pdf/docx/epub/url), `source_url`, `file_url`/`file_name`/`content_type`/`size_bytes` (nullable), `raw_text` (full extracted text — chunk offsets index into this, so re-chunking never re-parses), `language`, `tags` (text[]), `status` (pending/extracting/chunking/indexing/indexed/failed), `status_message` (the admin-visible reason), `chunk_count`/`indexed_chunk_count`, `content_hash` (sha256 of `raw_text` — unchanged means no re-index), `chunk_version`, `archived_at` (nullable) | Status is richer than `reference_documents.uploadStatus` because extraction can fail independently of indexing and an admin must tell those apart |
| `kb_document_chunks` | BaseWithoutTenant | `id` (uuid — **equals the Weaviate object UUID**), `document_id` (uuid, idx), `chunk_index`, `text`, `char_start`/`char_end` (offsets into `kb_documents.raw_text`), `page_from`/`page_to` (PDF), `section_path` (e.g. `Chapter 3 > Risk assessment`), `token_count`, `text_hash`, `upload_status` (pending/success/failed), `chunk_version`, **uniq(`document_id`, `chunk_version`, `chunk_index`)** | ~400-token chunks, 60-token overlap; sections are hard boundaries so a chunk never spans two chapters |
| `wa_contacts` | BaseWithoutTenant | `id` (uuid), `phone_e164` (**uniq**), `phone_last4` (derived, for list display), `consent_status` (pending/granted/opted_out), `consent_granted_at`/`opted_out_at`, `first_seen_at`/`last_seen_at`, `message_count`, `locale`, `blocked_at`/`blocked_reason` | `phone_e164` is identifiable data on mental healthcare workers: masked to last 4 in every API read except one logged reveal endpoint, and blanked to `erased:<id>` past the retention window |
| `wa_conversations` | BaseWithoutTenant | `id` (uuid), `contact_id` (uuid, idx), `started_at`/`last_message_at`, `message_count`, `last_language` | WhatsApp has no session concept, so one is defined: `conversationIdleMinutes` (default 1440) of silence closes the thread |
| `wa_messages` | BaseWithoutTenant | `id` (uuid), `conversation_id`/`contact_id` (uuid, idx each), `direction` (inbound/outbound), `provider_message_id` (**uniq** — the dedupe key), `body`, `language`, `handled_by` (template/rag/crisis/consent/declined/clarified/error/rate_limited/unsupported_media), `template_id`, `citations` (jsonb), `retrieval_meta` (jsonb — includes the provider and model that ACTUALLY ran), `latency_ms`, `status` (received/queued/processing/sent/failed/discarded), `error_message`, `in_reply_to_id`; idx (`conversation_id`, `createdAt`) | The unique `provider_message_id` is what makes dedupe correct: SQS is at-least-once *and* Meta retries independently. `retrieval_meta` carries the real model because `prompt_versions` stores only prompt text, so a model swap would otherwise be invisible |
| `wa_keyword_templates` | BaseWithoutTenant | `id` (uuid), `kind` (crisis/command/consent/faq), `name`, `match_type` (exact/contains/regex/any_of), `patterns` (text[]), `language_code` (null = all), `priority` (crisis 0–99, consent 100–199, command 200–299, faq 300+), `response_text` (supports `{helpline_numbers}`), `bypass_rag`, `terminal`, `active`, `mandatory`, `archived_at` | One ordered pass, first match wins, `terminal` stops everything. `mandatory` rows (crisis, STOP/START, consent) are editable but cannot be deleted or disabled |
| `wa_unanswered_questions` | BaseWithoutTenant | `id` (uuid), `message_id` (**uniq**), `conversation_id`, `question_text`, `language`, `reason` (no_hits/below_threshold/model_declined/error), `top_similarity`, `hit_count`, `status` (open/triaged/answered/dismissed), `assigned_to`, `resolution_note`, `linked_document_id`, `resolved_by`/`resolved_at` | Its own table rather than a view over `wa_messages`, because it carries admin workflow state that must outlive message-body retention. `clarify` outcomes are deliberately excluded — a vague question is not a corpus gap |

Bot configuration is **not** a table: it is one `global_settings` row, `name='whatsapp_bot'`, holding
the kill switch, consent and reply copy, rate limits, retrieval thresholds, `retentionDays` and
`crisisClassifierEnabled`. Defaults are merged per field, so a row written before a setting existed
picks the default up rather than leaving it undefined.

### 3.12 Bug Hunter (`bug-hunter`)

The autonomous find-and-fix agent's kill switch, comprehensive bug table, run history and event
transcript. The actual finding/fixing logic is an external Claude Code pipeline
(`.claude/workflows/bug-hunt.mjs` for a repo-wide sweep, `.claude/workflows/bug-fix-session.mjs` for
one bug, both in the workspace root) that authenticates and reports every step back over
`POST /v1/bug-hunter/runs` `.../report` `.../close` — this module owns none of that logic itself,
only the state.

Off by default: `bug_hunter_settings` is a singleton row (`id` pinned to 1 by a CHECK constraint),
seeded `mode='off'`. Every trigger path calls `POST /v1/bug-hunter/runs`, which reads this row before
doing anything else; a disabled call gets a `bug_hunt_runs` row stamped `status='skipped_disabled'`
and nothing further runs.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `bug_hunter_settings` | BaseWithoutTenant | `id` (smallint, **CHECK id=1** — singleton), `mode` (`off`/`manual`/`ai`, default `off`), `updated_by` (int, nullable) | The kill switch. Flipping it also writes a `bug_hunt_events` row (`stage='settings_changed'`, `run_id` NULL) so on/off history sits in the same timeline as run activity |
| `bug_findings` | BaseWithoutTenant | `id` (uuid), `run_id` (uuid, nullable FK → `bug_hunt_runs` ON DELETE SET NULL), `repo`, `source` (`test_failure`/`lint_error`/`code_review`/`production_log`/`reported_bug`/`analytics_suggestion`/`ux_signal`), `title`/`description`/`file`/`symbol`, `evidence`, `severity`, `proven`, `touches_guarded_path`, `reported_bug_id` (uuid, nullable FK → `roadmap_opportunities` ON DELETE SET NULL), `dedupe_key`, `status`, `pr_url`, escalation `question`/`answer`/`answered_by`/`answered_at`, `decided_by`/`decided_at`, **admin-edited brief (migration `1916000000000`):** `original_description`, `description_edited_by` (int), `description_edited_at`, **fix-session + release:** `dispatched_at`, `session_run_url`, `session_run_id` (bigint), `release_tag`, `release_run_id` (bigint), `release_run_url`, `released_by` (int), `released_at`, **manual kill switch (migration `1911000000000`):** `cancelled_by` (int), `cancelled_at`, **coordinated fixes:** `parent_finding_id` (uuid, nullable self-FK ON DELETE CASCADE), `step_index` (int), `step_summary`, **hand-pinned stage (migration `1936000000000`):** `stage_override` (varchar, nullable, CHECK matching `roadmap_opportunities.stage`), `stage_overridden_by` (int), `stage_overridden_at`, `metadata` (jsonb) | One row per bug from any source — the comprehensive table the admin tab renders. A row can exist before any run has looked at it: `RoadmapOpportunityService.create` inserts one (`source='reported_bug'`, `status='new'`) the moment a human files a bug. `(repo, dedupe_key)` is what stops a still-open bug getting a second row across nights. An admin may rewrite `description` before starting a fix session (`PATCH /v1/bug-hunter/findings/:id/description`), because that text is the fix agent's entire brief — `buildFixSessionPrompt` states the problem to it as nothing else, and `BugHunterRepoClassifierService` reads it to pick the repo. The edit is allowed from exactly the statuses a fix session can start from, sets no status of its own, leaves the linked `roadmap_opportunities` row (the reporter's own words) untouched, and preserves the finder's text in `original_description` on the FIRST edit only. It deliberately does NOT recompute `dedupe_key`. **`dedupe_key` is built from `file` + `source` + `symbol`, never from the raw `description`** (migration `1910000000000`): the description is LLM-written, so hashing it meant the same bug worded differently on a later night hashed differently and opened a duplicate — the sweep manufactured its own reviewer noise. `symbol` (the function/class/route/component) is the stable half; where a finder supplies none, a normalised *fingerprint* of the description is used instead, which still collapses rewordings without merging two distinct bugs in one file. A finding that arrives WITH a symbol and misses also retries the symbol-less key, so rows stored before their finder learned to emit one are adopted and re-keyed rather than duplicated once at the transition. The `reported_bug_id` link also runs in reverse, best-effort: when a finding carrying it transitions to `merged` — by any of the three routes there are, the fix agent PATCHing its own `gh pr merge --admin` through `BugFindingService.setStatus` (the common one, and where the nightly sweep's auto-merges land too), `reconcilePrOpenedFindings` noticing a PR a human merged by hand, or the parent once every step of a coordinated fix has merged in `advancePlans` — the shared `releaseLinkedRoadmapOpportunity` util (`src/bug-hunter/util/`) sets the linked `roadmap_opportunities` row to `stage='released'`, `owner='Bug Hunter Agent'`, `ownerUserId=NULL`, and stamps `releasedAt` only if it wasn't already `released` — never on the `RELEASING`/`RELEASED` production-release path, which is a separate, human-gated step. **The coarse roadmap stage a reader sees on a finding is DERIVED from `status`, not stored** (`src/bug-hunter/util/bug-finding-stage.util.ts`): bugs no longer render on the roadmap board at all, so the New/Prioritised/In development/Released ladder has to be legible here, and deriving it means nothing can go stale on a screen where nobody would notice. `stage_override` is the sole exception — a bug fixed OUTSIDE Bug Hunter (a hand-written PR, a config change, a fix that rode along with other work) leaves `status` at `new` forever, and only a human can say otherwise. A pin STICKS: later transitions no longer move the stage, because the admin who set it is the only party who knows about the out-of-band fix. `PATCH /v1/bug-hunter/findings/:id/stage` with `stage: null` clears it and returns the row to derivation, wiping `stage_overridden_by`/`_at` with it |
| `bug_hunt_runs` | BaseWithoutTenant | `id` (uuid), `trigger` (`scheduled`/`manual`/`fix_session`), `repo`, `status` (`running`/`completed`/`failed`/`skipped_disabled`), `finished_at`, `found_count`/`auto_merged_count`/`pr_opened_count`/`dismissed_count`, `total_token_cost_usd` (numeric, snapshotted from `llm_usage` at close — not the source of truth), `total_input_tokens`/`total_output_tokens` (int, nullable, migration `1912000000000` — the raw token counts behind `total_token_cost_usd`, snapshotted the same way at the same time; null for runs closed before this existed and never backfilled). **This table's physical columns are camelCase** (`finishedAt`, `foundCount`, `totalTokenCostUsd`, `totalInputTokens`, …), unlike the snake_case names this doc uses for readability: `1912000000000` took the doc literally and added `total_input_tokens`/`total_output_tokens`, which the entity could not see, so every statement naming them failed — `startRun`'s INSERT lists all mapped columns, which took "Put me on it", `POST pipeline/runs`, `.../close`, `.../cost` and `GET runs` down with it. Renamed to camelCase in `1915000000000`, `metadata` (jsonb) | One row per (repo, trigger) sweep — a five-repo nightly run is five rows, never merged into one. `trigger='fix_session'` is the on-demand single-bug variant; its totals only ever sum to one finding |
| `bug_hunt_events` | BaseWithoutTenant | `id` (uuid), `run_id` (uuid, nullable FK → `bug_hunt_runs` ON DELETE CASCADE), `finding_id` (uuid, nullable FK → `bug_findings` ON DELETE SET NULL), `repo`, `stage` (`finder_result`/`verify`/`fix_attempt`/`test_written`/`doc_updated`/`pr_opened`/`merged`/`escalated`/`error`/`skipped_disabled`/`settings_changed`/`session_dispatched`/`release_dispatched`/`released`/`release_failed`/`plan_created`/`step_started`/`cancelled`/`description_edited`/`stage_changed`), `summary` (text), `payload` (jsonb — structured detail only, **never raw log/PII content**), `suggestion_id` (uuid, nullable FK → `analytics_suggestions` ON DELETE SET NULL) | **Append-only** transcript, modeled on `copilot_messages` (§3.9). Deliberately not `audit_logs` (§3.8) — that table is a HIPAA compliance log with its own taxonomy; this is unrelated operational telemetry. Release-lifecycle rows carry `run_id` NULL (like `settings_changed`) because they land long after the producing run closed |

| `bug_hunter_notifications` | BaseWithoutTenant | `id` (uuid), `finding_id` (uuid, nullable FK → `bug_findings` ON DELETE CASCADE), `run_id` (uuid, nullable FK → `bug_hunt_runs` ON DELETE SET NULL), `repo`, `level` (`info`/`problem`/`action_needed`), `title`, `body`, `read_at`, `read_by` (int) | Bug Hunter's **only** outbound channel, rendered as an inbox in the admin tab. It used to post escalations, run summaries and release outcomes to Slack via NotificationService; those three methods were deleted in migration 1900000000000's change. NOT the platform `notifications` domain — those address one end user and drive email/push, these address whoever is minding Bug Hunter and never leave the tab. Read is per-notification, not per-admin: several people work the same queue |

**A bug that needs more than one repo becomes a parent plus ordered children.**
A fix session only ever has one repo checked out, so on finding that a complete
fix spans repos the agent reports a plan instead of landing half of it; each step
becomes its own `bug_findings` row under `parent_finding_id`, and
`(parent_finding_id, step_index)` is UNIQUE. **The order is the contract**: steps
are fixed one at a time and released one at a time in `step_index` order, because
a frontend live before the backend field it reads is the production break the
whole design exists to prevent. Child rows are excluded from the main findings
list (`parent_finding_id IS NULL`) so a coordinated fix reads as one bug, with its
steps in that bug's drawer. The parent's status is derived from its children by
`BugFixSessionService`, never set by a fix agent.

**`bug_findings.status` is the whole lifecycle**, and its CHECK constraint is the authority:
`new` → `pending_approval` → `approved` (Manual mode's admin gate) or straight to `fixing` (AI mode);
`queued` → `fixing` on the on-demand path; then `pr_opened` → `merged` → `releasing` → `released`,
with `dismissed`/`rejected`/`failed`/`release_failed`/`cancelled` as the unhappy ends. `blocked`
is a plan step whose turn hasn't come; `coordinating` is a parent working through
its plan. `release_failed` is
deliberately distinct from `failed`: the former means the fix IS on master and only the deploy went
red, which is a completely different thing for an admin to act on. `cancelled` (migration
`1911000000000`) is likewise distinct from `failed`: it means an admin pressed "Stop fix session" on a
`queued`/`fixing` run that looked stuck or was looping, rather than the fix agent giving up on its own —
`BugFixSessionService.cancelFixSession` also calls `GithubActionsService.cancelRun` to actually cancel
the GitHub Actions job, not just flip the status. Like `failed`, a `cancelled` finding can have a fresh
fix session started for it. Cancelling one step of a coordinated plan halts the whole plan (the parent
becomes `cancelled` too) rather than silently continuing to the next step.

**Sweeps are now actually triggered.** Until migration `1910000000000`'s change nothing started
one: `bug_hunt_runs.trigger='scheduled'` was a valid value with no producer anywhere, there was no
`schedule:` workflow, and the only route that opened a run was api-key-only — a sweep happened solely
when someone ran `.claude/workflows/bug-hunt.mjs` by hand in a Claude Code session. That script is a
Claude Code *Workflow* (it uses `agent()`/`parallel()`/`budget` primitives), so a GitHub runner cannot
execute it, which is why the gap existed. There are now two executors over **one** definition: the
interactive script, and `bug-hunt-sweep.yml` in each repo, which fetches its protocol from
`GET pipeline/sweep-prompt` and hands it to Claude Code exactly as `bug-fix-session.yml` does with the
fix protocol. `POST /v1/bug-hunter/runs/trigger` (human, toggle-gated) opens the run then dispatches,
so the tab shows it immediately; the nightly cron opens its own. Test/lint commands and per-repo
fixability live once in `bug-hunt-repos.constants.ts` and are served over
`GET pipeline/repo-commands` — they previously existed twice, in `bug-hunt.mjs` and
`bug-fix-prompt.ts`, and had already drifted by an entry.

**An unanswered question no longer rots silently.** The inbox is pull-only by design, so a question a
2am sweep asks would otherwise sit unread indefinitely with the finding stuck at `needs_input` and
nobody aware it is waiting on them. An hourly `bug-hunter-stale-escalation-digest` task raises ONE
`action_needed` notification covering every question unanswered for more than four hours, at most once
a day, and nothing at all when none are waiting. Only an on-demand fix session waits for an answer
inline — there an admin has just pressed a button and is probably still watching; a sweep asks and
moves on.

**Two dispatches, reconciled not awaited.** "Start fix session" and "Release to production" both fire
a GitHub `workflow_dispatch`, which answers 204 with **no run id** — so `dispatched_at` is the only
correlation key at the moment of the call, and the `bug-fix-session-reconcile` 5-minute scheduled
task is what later resolves the run, attaches its URL, and settles `releasing` into
`released`/`release_failed` from the run's own conclusion. Nothing in the request path waits on CI.

Cost is read, not stored twice: every LLM call inside the pipeline calls `LlmUsageService.record()`
tagged `task=LlmTask.BUG_HUNTER` and `metadata.runId`, so `llm_usage` (§3.8) stays the one source of
truth for token cost and `bug_hunt_runs.total_token_cost_usd` is just a snapshot taken at close time
for the admin tab's run-history table to render without a join.

**`llm_usage.cacheCreationTokens`** (nullable int, migration `1935000000000`) is a new physical column
for prompt-cache WRITE tokens, alongside the existing `cachedTokens` (cache READ tokens) column.
`computeCostUsd` (`analytics/constants/llm-pricing.constants.ts`) now prices both off a model's base
input rate (0.1x for reads, 1.25x for writes) — previously prompt-cache tokens were tracked but never
priced, which is why Bug Hunter's "Est. cost" tile undercounted the real Anthropic bill: an agentic loop
that resends a growing transcript every turn generates a lot of cache-write tokens.

---

### 3.13 Product Roadmap (`product-roadmap`)

Vote-based idea and bug board, migrated from a standalone Supabase app (migration `1871000000000`
onward). **Not multi-tenant** — this is Ally's own internal roadmap, so every table here extends
`BaseWithoutTenant` and carries no `tenantId`.

Two things about this domain surprise people. First, **there is no `priorityScore` column**: the score
is `SUM(votes)` computed as a SQL aggregate on every read, because the code most likely to get the
arithmetic wrong is split/merge (which moves hundreds of allocation rows in one transaction) and a
wrong counter can't be recovered without a rebuild job. If it ever needs to be faster the next step is
a MATERIALIZED VIEW, never a counter. Second, **`productGoal` and `owner` are FKs BY NAME**
(`ON UPDATE CASCADE`), not by id, because saved-view state filters on names — swapping in ids would
make eight migrated views silently match nothing.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `roadmap_opportunities` | BaseWithoutTenant | `id` (uuid), `description` (text, CHECK ≤1000 & non-blank), `type` (`idea`/`bug`), `stage` (`new`/`prioritised`/`under_development`/`released`/`archived`), `productGoal` (text, FK **by name** → `roadmap_product_goals.name` ON UPDATE CASCADE ON DELETE RESTRICT), `owner` (text, nullable, legacy FK by name ON DELETE SET NULL), `ownerUserId` (int, nullable FK → `users` ON DELETE SET NULL), `prd`/`claudePrompt` (text, CHECK ≤20000), `releasedAt`, **month board:** `plannedMonth` (varchar(7), nullable, CHECK `^[0-9]{4}-(0[1-9]\|1[0-2])$`), `boardPosition` (int, default 0), **effort sizing (migration `1940900000000`):** `effort` (varchar(3), nullable, CHECK `NULL` or `s`/`m`/`l`/`xl`/`xxl`), **Weaviate state:** `embeddingStatus`/`embeddingAttempts`/`embeddedAt`/`textHash`, **consumer bug reports (migration `1909000000000`):** `source` (`staff`/`consumer`, default `staff`), `tenant_id` (varchar, nullable, informational only — does NOT tenant-scope this table), `reporterContext` (jsonb, nullable — auto-captured client context: screen/appVersion/device/os/clientTimestamp), `createdBy`/`updatedBy` (int), `deletedAt` | The atomic unit. **Soft delete**, which is why a delete MUST also remove the vector — Postgres filters `deletedAt IS NULL`, Weaviate has no idea, and a missed delete makes duplicate detection propose a deleted row forever. `releasedAt` is stamped only on the *transition* into `released` and never re-stamped; ~173 of 280 migrated released rows have it NULL because the source trigger behaved the same way, and **nothing may backfill it**. A `bug`-type row filed by a logged-in consumer via `POST /product-roadmap/bug-reports` runs through the exact same `RoadmapOpportunityService.create()` pipeline as a staff-filed one (see `bug_findings` below) — `source='consumer'` and `createdBy` (the consumer's own `users.id`, same shared table as staff) are the only things that distinguish it. **`type='bug'` rows are never LISTED by this domain.** `EXCLUDE_BUGS_SQL` in `RoadmapOpportunityRepository` drops them from the shared `projectedQuery` (so the table, the month board and lane totals inherit it) and from the raw-SQL facets, month bounds and max-score reads; `findDuplicates` filters its candidates to `type='idea'`; and `create`/`update` skip the realtime `OPPORTUNITY_UPSERTED` broadcast for a bug so a filed one cannot flash onto a board it is not on. Bug Hunter's `bug_findings` table is where a bug is read. The row here is still written, and is still the record of who reported what with what context — `findOneWithScore` is deliberately NOT filtered, so the `?opportunity=<id>` deep link can recognise a bug id and send the reader to Bug Hunter instead of 404ing. **`effort` is a shirt size and is NULLABLE with no default and no backfill** — every row predating migration `1940900000000` is unsized, and a `DEFAULT 's'` would have asserted that 432 existing rows are the smallest thing the team does. NULL means "not estimated" and is a permanent legal state, not a gap: "unsized" and "sized as smallest" are different facts. Nothing gates on it and nothing filters or sorts by it, so it carries no index. Readable by anyone holding `VIEW_PRODUCT_ROADMAP` (it rides the shared response DTO, unstripped) and writable only through `PATCH /opportunities/:id`, which requires `EDIT_PRODUCT_ROADMAP` |
| `roadmap_allocations` | BaseWithoutTenant | `id` (uuid), `userId` (int), `opportunityId` (uuid FK ON DELETE CASCADE), `periodKey` (varchar(7), CHECK `^[0-9]{4}-(0[1-9]\|1[0-2])$`), `votes` (int, CHECK 0–100, renamed from `coins` by migration `1940700000000`). UNIQUE `(userId, opportunityId, periodKey)` | One person's votes on one opportunity in one month. No `deletedAt` — `votes=0` deletes the row. `periodKey` is **server-computed in UTC and never accepted from a client**: the source let any period be written, which was unbounded score inflation since the score sums every period forever. The 100-vote monthly cap is enforced twice, by `roadmap_enforce_monthly_cap()` (migration `1871000000001`, retargeted onto `votes` by `1940700000000`) and by the service |
| `roadmap_product_goals` | BaseWithoutTenant | `id` (uuid), `name` (text UNIQUE), `position` (int, default 0) | FK target, so no soft delete |
| `roadmap_opportunity_owners` | BaseWithoutTenant | `id` (uuid), `name` (text UNIQUE), `position` (int, default 0) | Legacy taxonomy. New human assignments use `ownerUserId` and must be an Ally super-admin. One exception, seeded by migration `1913000000000`: `'Bug Hunter Agent'`, written to the legacy `owner` column (never `ownerUserId`) by the shared `releaseLinkedRoadmapOpportunity` util — see `bug_findings` below |
| `roadmap_opportunity_comments` | BaseWithoutTenant | `id` (uuid), `opportunityId` (uuid), `body` (text, CHECK ≤500), `createdBy`/`updatedBy`, `deletedAt` | |
| `roadmap_interview_notes` | BaseWithoutTenant | `id` (uuid), `title`, `interviewee`, `transcript`, `summary`, `createdBy`/`updatedBy`, `deletedAt` | LLM-summarised user interviews |
| `roadmap_release_notes` | BaseWithoutTenant | `id` (uuid), `title` (nullable), `content` (text), `opportunityIds` (uuid[], default `'{}'`), `createdBy`/`updatedBy`, `deletedAt` | The uuid[] is a deliberate denormalised snapshot, not a join table — a published note should keep saying what it was generated from even after those opportunities change |
| `roadmap_saved_views` | BaseWithoutTenant | `id` (uuid), `name`, `state` (jsonb), `pinned` (bool), `createdBy`/`updatedBy`, `deletedAt` | Read visibility is row-level: your own, plus anything pinned. `state` includes the board `layout`, so a saved view remembers whether it was a table or a month board |
| `roadmap_user_tab_order` | BaseWithoutTenant | `id` (uuid), `userId` (int UNIQUE), `viewIds` (uuid[], default `'{}'`) | Per-user tab order, intentionally tolerant of stale and missing ids |
| `roadmap_user_map` | — | `sourceUserId` (uuid PK), `sourceEmail`, `sourceEmailLower` (UNIQUE), `sourceRole`, `allyUserId` (int), `createdByMigration` (bool) | Supabase→Ally identity crosswalk from the import |

**Month boards** (`plannedMonth`, `boardPosition`, `CHK_roadmap_opps_planned_month` and
`idx_roadmap_opps_month_board`) are added by migration `1902000000000`, read by
`GET /v1/product-roadmap/board` and written by `PUT /v1/product-roadmap/board/lane`.

**A card's lane is `plannedMonth`, until it ships.** `plannedMonth` is an intention and
`releasedAt` is an outcome, so they are separate columns and the board derives the lane it shows —
release month once `stage='released'` with a non-NULL `releasedAt`, otherwise `plannedMonth`, otherwise
the Unscheduled lane. That rule lives in exactly two places, `effectiveMonthOf()` in
`util/roadmap-month.util.ts` for the write path and API response, and `EFFECTIVE_MONTH_SQL` in
`repository/roadmap-opportunity.repository.ts` for grouping the read; **change both together**.
Collapsing them into one field would erase the discrepancy the board exists to surface — planned for
March, shipped in May. A shipped card therefore can't be dragged to another month (422), only
reordered within its release month.

`boardPosition` ships with **no backfill on purpose**: DEFAULT 0 leaves every row tied and the board's
ORDER BY falls through to `priorityScore DESC`, so every lane is already vote-sorted on day one and
dragging progressively replaces that with a human order, lane by lane. Gaps and duplicate positions are
harmless — the ORDER BY has deterministic tiebreaks — so a reorder rewrites one lane rather than
maintaining a globally sparse sequence.

> ⚠️ **`CHECK` constraints on `roadmap_opportunities` are hand-written and TypeORM cannot see them.**
> `migration:generate` will not produce `CHK_roadmap_opps_stage` or `CHK_roadmap_opps_planned_month`,
> and running it against this table proposes dropping them. Adding a `stage` value or changing the
> month format means dropping and recreating the constraint in a hand-written migration.

### 3.14 Builder (`builder`)

The admin agent that interviews a platform admin into a PRD and then builds it. **Not multi-tenant** —
every table extends `BaseWithoutTenant`; `builder_sessions.tenant_id` is a nullable varchar carried for
cost attribution and the per-org session caps only, and does **not** tenant-scope reads. A session is
private to its creator, enforced in `BuilderSessionService.getSession`.

Two things here are worth knowing before you touch them. First, **status and stage are deliberately
different kinds of thing**: `status` is what ally-be owns and can transition on its own (an admin starts
a build, answers, cancels), while `currentStage` is only ever learned from an event a runner reports.
Promoting a stage to a status would let a dead runner strand a session in a state nothing can move it
out of. Second, **the PRD is a draft plus an append-only version trail**, the same pair as
the retired `roleplay_specs`/`roleplay_spec_versions` pair, because both the agent (`update_prd` patches) and the admin
(direct section edits) mutate one document — the snapshots are the only way to answer "who changed this
requirement?" afterwards.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `builder_sessions` | BaseWithoutTenant | `id` (uuid), `title` (varchar(200)), `slug` (varchar(80) UNIQUE), `status` (varchar CHECK: `INTERVIEWING`/`PRD_READY`/`BUILDING`/`WAITING_FOR_INPUT`/`COMPLETED`/`FAILED`/`CANCELLED`), `currentStage` (varchar CHECK: `SETUP`…`DONE`, nullable), `repos` (jsonb), `engine`/`model`, `lastMessageSeq`, `lastRunSequence` (int), `budgetUsd`/`totalCostUsd` (numeric), `runnerMinutes` (int), `tenant_id` (varchar, nullable), `createdBy`/`updatedBy`, `deletedAt` | One interview → zero or more build runs. `slug` is the base of every branch the session pushes (`builder/<slug>`) and its unique index **includes soft-deleted rows** — the remote branch outlives the row, so reusing a slug would push onto someone else's history. `lastMessageSeq` and `lastRunSequence` are both atomic `UPDATE … RETURNING` counters, behind message-seq and run-number allocation respectively — run numbers used to be read-then-incremented off `MAX(sequence)`, so a double-clicked answer could dispatch two runners at the same branches |
| `builder_messages` | BaseWithoutTenant | `id` (uuid), `sessionId` (uuid FK ON DELETE CASCADE), `seq` (int), `role` (`user`/`assistant`), `content` (text), `toolCalls`/`toolResults`/`metadata` (jsonb). UNIQUE `(sessionId, seq)` | Append-only, **no soft delete** — history must replay faithfully into the Anthropic messages array (text + tool_use + tool_result blocks rebuilt from the jsonb columns). `seq` is allocated by an atomic `UPDATE builder_sessions SET lastMessageSeq = lastMessageSeq + 1 RETURNING` inside the insert transaction, so concurrent appenders cannot collide. Question payloads live in the assistant row's `metadata.questions`; the raw answer payload lives on the user row. Append-only has one exception: the assistant row for the turn *currently streaming* is inserted empty and rewritten as the turn progresses (`metadata.streaming` true), so a restart mid-turn keeps the prose and tool record already earned; the next turn closes any row left open as `metadata.interrupted`. Once `streaming` is false the row never changes again |
| `builder_prd_docs` | BaseWithoutTenant | `id` (uuid), `sessionId` (uuid UNIQUE, FK ON DELETE CASCADE), `draft` (jsonb), `versionNumber` (int) | The living PRD. `draft` shape is `BuilderPrdDocument` in `type/builder-prd.type.ts`; RFC-6902 patches address it by JSON Pointer, so **renaming a key breaks both the agent's patches and the admin UI's section editor** |
| `builder_prd_versions` | BaseWithoutTenant | `id` (uuid), `docId` (uuid FK ON DELETE CASCADE), `versionNumber` (int), `content` (jsonb), `author` (CHECK `agent`/`admin`), `changeSummary` (text). UNIQUE `(docId, versionNumber)` | Immutable snapshot per mutation. The unique index is load-bearing: it is what makes the retry in `BuilderPrdService.persistDraftMutation` correct — a lost race fails the constraint and retries instead of silently overwriting |
| `builder_repo_maps` | BaseWithoutTenant | `id` (uuid), `repo` (varchar(80) UNIQUE), `commitSha`, `mapMd` (text), `stats` (jsonb), `generatedAt` | Repo Knowledge Packs: a condensed per-repo map regenerated by the `builder-context-refresh` workflow, not per session. It is what makes the interviewer codebase-aware cheaply — the map is the index that tells the agent which few files are worth a live GitHub read |
| `builder_lessons` | BaseWithoutTenant | `id` (uuid), `sessionId` (uuid, **no FK**), `repo` (varchar, deprecated), `repos` (jsonb), `category` (CHECK `gotcha`/`convention`/`estimate`/`process`), `lesson` (text), `status` (CHECK `candidate`/`active`/`merged`/`retired`), `pinned` (bool), `sourceCount`, `sourceSessionIds` (jsonb), `timesApplied`, `timesContradicted`, `mergedIntoId`, `tags` (jsonb), `lastAppliedAt` | Cross-session memory from build retrospectives, fed back into later prompts. No FK to `builder_sessions` on purpose: a lesson outliving the session that learned it is the entire point. A **curated set**, not an append-only log: raw bullets land as `candidate` and a consolidation pass merges duplicates into one row with a `sourceCount`, rewrites imprecise ones and retires the rest, because the context a prompt can spend on lessons is fixed and five rows saying the same thing crowd out four that don't. `timesApplied`/`timesContradicted` make retirement evidence rather than taste — runs cite `appliedLessonIds` in their report, and the outcome pipeline credits them only when the work actually merged. `repos` replaces `repo` because a two-repo build used to lose its attribution entirely and become platform-wide. A `pinned` lesson is one the curator may never edit or retire |
| `builder_pr_feedback` | BaseWithoutTenant | `id`, `pullRequestId` (FK CASCADE), `sessionId` (FK CASCADE, denorm), `kind` (CHECK `ci_failure`/`review_comment`/`review`), `externalId`, `author`, `body`, `path`, `line`, `status` (CHECK `pending`/`in_fix`/`addressed`/`dismissed`/`stale`), `fixRunId`, `replyUrl`, `addressedAt`. UNIQUE `(pullRequestId, kind, externalId)` | What happened to a Builder pull request after it opened: a failing check, an inline review comment, a review verdict. A table of its own rather than reusing `builder_questions` — a question stops a run and waits for the session's owner, while feedback arrives while nothing is running, from someone else, and it is *Builder* that has to act. The unique index is load-bearing: this is polled, so every reconcile tick re-reads every comment and the write must upsert or the table would grow with the clock. CI failures are keyed `sha:check`, so a re-run of the same failure is one item but the same check failing after a new push is a new one |
| `builder_exemplars` | BaseWithoutTenant | `id`, `sessionId` (FK CASCADE, UNIQUE), `title`, `repos` (jsonb), `prdSnapshot` (jsonb), `planMd`, `diffstat` (jsonb), `outcome` (CHECK `open`/`merged`/`partially_merged`/`closed_unmerged`/`failed`/`cancelled`), `fixRunCount`, `reviewCommentCount`, `ciFailureCount`, `costUsd`, `runnerMinutes`, `timeToMergeHours`, `failureTags` (jsonb), `summaryMd`, `lastOutcomeSyncAt` | One finished build, archived with **how it actually turned out**. Lessons capture what an agent believed in the minutes after finishing — the worst moment to judge the work; whether the PR merged, was closed unmerged, or needed four fix runs is knowable only later and is the part that says which approaches work. Failures are archived too: "a similar build tried this and the PR was closed unmerged because X" is worth more to the next attempt than any number of wins. UNIQUE on `sessionId` because archiving is called from run settling, which can fire more than once per session. `summaryMd` is the ~150-word digest that actually reaches a prompt; the scoreboard aggregates entirely off this table |
| `builder_milestones` | BaseWithoutTenant | `id`, `sessionId` (FK CASCADE), `position` (int), `title`, `summaryMd`, `requirementIds` (jsonb), `technicalNotesMd`, `status` (CHECK `PENDING`/`BUILDING`/`WAITING_FOR_INPUT`/`COMPLETED`/`FAILED`/`SKIPPED`), `branchSlug`, `startedAt`/`completedAt`, `error`. UNIQUE `(sessionId, position)` | Epic mode: one shippable slice of a large PRD, built in order, each landing as its own stacked pull request. Rows on the session rather than child sessions — a child session would duplicate the interview and the PRD, and every session owns a unique `slug` naming its branches, so five children would scatter one feature across five unrelated branch families. Here the slug stays one family (`builder/<slug>-m1`, `-m2`). `requirementIds` is validated to assign every PRD requirement **exactly once**: a requirement in two milestones gets built twice, and one in none is silently dropped |

**Build tables** (migration `1934100000000`). ally-be cannot check out a repo, run a test suite or open
a pull request from inside its container, so the build half runs as a GitHub Actions job and these
tables are the protocol between the two.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `builder_build_runs` | BaseWithoutTenant | `id` (uuid), `sessionId` (FK ON DELETE CASCADE), `sequence` (int), `mode` (CHECK `build`/`resume`), `status` (CHECK `QUEUED`/`RUNNING`/`SUCCEEDED`/`FAILED`/`CANCELLED`/`TIMED_OUT`/`WAITING_FOR_INPUT`), `resumeOfRunId`, `engine`, `model` (the **coder** tier), `plannerModel`/`verifierModel`, `branchSlug`, `branches` (jsonb `{repo: branch}`), `githubRunId` (bigint, **nullable**), `githubRunUrl`, `dispatchedAt`, `startedAt`/`completedAt`, `lastEventSeq`, `cost` (jsonb `{phases: {<phase>: {model, usd, usage}}}`), `costUsd`, `runnerMinutes`, `cancelledBy` | One dispatched run; several per session (first `build`, a `resume` per pause, plus retries). **`githubRunId` is nullable because `workflow_dispatch` answers 204 with no run id** — the row is created *before* the dispatch (the runner gets its own id as a workflow input), `dispatchedAt` is stamped from our clock a beat *before* the POST so skew can only widen the search window, and the 5-min reconcile correlates the two via `findRunSince`. Cancel, run links and status settling are all eventually consistent as a result. `WAITING_FOR_INPUT` is terminal *for the run*: a pause is a deliberate `exit 0`, and the answer spawns a fresh `resume` run. A run is several engine invocations (plan, code, remediation rounds, review rounds, finalise) at different model tiers, so `cost` is keyed **by phase** and each POST upserts one key — which both bills the planner and reviewer passes that used to be invisible and makes the end-of-workflow safety-net re-report idempotent |
| `builder_build_events` | BaseWithoutTenant | `id`, `runId` (FK ON DELETE CASCADE), `sessionId` (denorm), `seq` (int), `stage` (CHECK), `type` (CHECK, 19 values), `payload` (jsonb, truncated to 8KB on ingestion). UNIQUE `(runId, seq)` | The live transcript, at engine granularity. Two channels feed it: *transcript* types (`text`/`tool_call`/`tool_result`/`file_edit`) normalised from the engine's stream-json by `scripts/builder/forward-events.mjs`, and *semantic* types the agent asserts itself via curl helpers (`stage_change`, `todo`, `plan`, `verification`, `pr_opened`…). The semantic ones drive the phase rail, todo list and pause logic, so they stay meaningful whichever engine ran. `seq` is allocated by one atomic block reservation per batch, which is what makes a redelivered batch collide on the unique index rather than duplicate. `gate_result` is the exception to "the agent asserts it": it is posted by `scripts/builder/run-test-gate.sh` from a real command's exit code, and `/complete` **refuses a `done` without a passing one** — before it existed, testing was prompt-instructed and a run that skipped it entirely could self-report success |
| `builder_questions` | BaseWithoutTenant | `id`, `sessionId` (FK CASCADE), `runId`, `groupId` (uuid), `position`, `question` (jsonb, the interview widget shape), `answer`/`answerText`, `status` (CHECK `pending`/`answered`/`superseded`), `answeredBy` | Mid-build pauses. **`groupId` is what lets one pause carry several questions** — the agent is told to batch everything ambiguous into a single stop, because each stop costs a runner teardown, a fresh dispatch and a wait on a human. The resume does not dispatch until the whole group is answered. Cancelling a run supersedes its pending questions so a late answer cannot resume a stopped build |
| `builder_pull_requests` | BaseWithoutTenant | `id`, `sessionId` (FK CASCADE), `runId`, `repo`, `branch`, `prNumber`, `prUrl`, `title`, `ciStatus` (success/failure/pending/none), `state` (open/closed), `headSha`, `lastCheckedAt`, `fixRunCount`, `merged`/`mergedAt`. UNIQUE `(sessionId, repo, branch)` | Unique per repo: a resume pushes more commits to the same branch, updating the existing PR rather than opening a second. `merged` is refreshed by the reconcile pass — the interesting half of a PR's life happens after Builder stops watching The key includes `branch` because an epic opens one PR per repo *per milestone*; on `(sessionId, repo)` alone, milestone 2 would overwrite milestone 1's row and the first pull request would vanish from the session view while staying open on GitHub. `state` is what finally distinguishes a merged PR from one closed **without** merging — the same row before, and the second is the most informative outcome the flywheel gets |
| `builder_reports` | BaseWithoutTenant | `id`, `sessionId` (FK CASCADE), `runId`, `type` (CHECK `run_report`/`session_report`/`retrospective`/`post_mortem`), `contentMd`, `metrics` (jsonb, carries `retrospective[]` and `appliedLessonIds[]`) | The agent's account of its own work; the PR body is written from it. A `retrospective` array inside `metrics` is unpacked into `builder_lessons` on ingestion — that unpacking *is* the compounding mechanism, which is why it happens at write time rather than in a later pass that might not run |
| `builder_settings` | BaseWithoutTenant | singleton: `enabled` (bool, **default false**), `maxConcurrentBuilds` (int, default 3), `defaultBudgetUsd` (**now actually applied at session creation**), `maxRunnerMinutes`, `defaultEngine`/`defaultModel` (legacy coder fallback), `plannerModel`/`coderModel`/`verifierModel` | Seeded **disabled** by the migration. The feature toggle governs who sees the tab; this governs whether the thing behind it will dispatch at all. An agent that writes code and opens PRs should not become reachable merely because a migration ran. The per-tier model columns resolve run override → session (coder only) → these → `BUILDER_MODEL_DEFAULTS`, which is the single source of model defaults. `maxRunnerMinutes` is a second, independent ceiling: a run can be cheap in tokens and still hold a runner for two hours, which `totalCostUsd` cannot see. `maxConcurrentBuilds` counts **runs in QUEUED/RUNNING**, not sessions — a session parked on a question holds no runner, and one session can hold several runs |
| `builder_notifications` | BaseWithoutTenant | `id`, `adminId` (int, no FK), `sessionId` (FK CASCADE), `kind` (CHECK), `message` (text), `readAt` | What happened while the admin was elsewhere. Messages are written whole in the agent's voice rather than templated client-side, because the inbox and any future push need the same sentence |

> ⚠️ The `CHECK` constraints on every Builder table are hand-written (varchar + CHECK, not Postgres
> enums), per the `bug_findings` precedent. TypeORM cannot see them, so `migration:generate` against
> these tables proposes dropping them. Adding a status, stage, event type or category means a
> hand-written migration.

**Cost telemetry:** interview turns record to `llm_usage` under `LlmTask.BUILDER_INTERVIEW` with both
`cachedTokens` (cache reads — the saving) and `cacheCreationTokens` (cache writes — what the saving cost
to set up). Prompt-cache effectiveness is the main lever on this agent's cost, and with only one of the
two counters a twenty-turn interview's real spend is unknowable. Build-run usage reports under
`LlmTask.BUILDER_BUILD`.

---

### 3.15 Analytics Suggestions & UX Signals (`analytics-suggestions`, `ux-signals`)

Two producers, one review queue. `analytics_suggestions` is the queue; `ux_signal_scans` is the run
log of the second producer.

| Table | Base | Key columns | Notes |
|-------|------|-------------|-------|
| `analytics_suggestions` | BaseWithoutTenant | `id` (uuid), `batch_id` (uuid, **not** a FK — no batch table), `title` (text, ≤200), `body` (text, ≤1000), `rationale`, `evidence` (jsonb string[]), `suggested_goal` (text, **nullable**, no FK), `suggested_type` (`idea`/`bug`), `status` (`pending`/`accepted`/`rejected`), **producer (migration `1940100000000`):** `source` (varchar(20), CHECK `analytics_window`/`ux_signal`, default `analytics_window`), `rejected_reason`, `opportunity_id` (uuid, nullable FK → `roadmap_opportunities` ON DELETE SET NULL), `window_range`/`window_from`/`window_to`/`window_label`, `model`, `created_by`/`updated_by` (int) | One LLM-drafted proposal awaiting a decision. **No soft delete** — a decision is permanent and feeds the next run, so `rejected` already says everything a delete would. Status is one-way: `pending` → `accepted`\|`rejected`, and `rejected_reason` is fed back into later prompts as a standing decision, which is why it is a column and not a UI-only confirmation. `suggested_goal` is nullable ON PURPOSE and carries no FK: an answer that is not a live goal is discarded to NULL rather than stored (unvalidated model taxonomy once polluted ~54% of the roadmap's goal data), and it is re-validated at accept time so a goal renamed while a suggestion waited is a 422 the reviewer can fix rather than a dangling reference. Accept is **claim-then-file with compensation, not one transaction** (`AnalyticsSuggestionsService.accept`): the `UPDATE … WHERE status='pending'` claims the row, then `RoadmapOpportunityService.create` files it, and a throw reverts the claim — a single transaction is impossible because `create`'s vector index and realtime emit happen after its own commit. `source` distinguishes the two producers for a reader; both share this table and one accept/reject flow, and NOT NULL DEFAULT `analytics_window` is the historical truth rather than a backfill guess, since every pre-existing row came from a window run |
| `ux_signal_scans` | BaseWithoutTenant | `id` (uuid), `trigger` (varchar(10), CHECK `scheduled`/`manual`), `status` (varchar(10), CHECK `running`/`completed`/`failed`), `window_from`/`window_to` (date), `signals_detected`, `findings_created`, `suggestions_created`, `skipped_duplicates` (int, all default 0), `error` (text), `metadata` (jsonb — per-detector counts and `failedDetectors`), `started_by` (int, nullable — NULL for scheduled runs, no FK), `started_at`/`finished_at` (timestamptz) | One UX Signals scan: read PostHog, triage what crossed a threshold, file it. The row does three jobs. **It is the cadence** — the shared scheduler has no daily tick (only 5min/15min/30min/hourly/monthly), so the hourly task self-gates on the newest non-running row's `started_at`; that has to be durable or every redeploy re-scans. **It is the concurrency guard** — a `running` row younger than 15 minutes blocks a second scan, and one older is treated as abandoned so a crash mid-scan cannot wedge the pipeline. The block is enforced by the **partial unique index `uq_ux_signal_scans_single_running` on `status` WHERE `status='running'`** (migration `1940800000000`), not by the in-flight `COUNT(*)` that precedes the insert: a double-clicked "Scan now" has both callers reading zero in flight before either commits, so the count cannot separate them and the insert has to. The loser's `23505` is translated back into the same 409 a sequential second press gets. Migration `1940200000000`'s `idx_ux_signal_scans_running` remains, ordering the stale sweep's `started_at` predicate. **It is what a human reads.** `skipped_duplicates` is its own column rather than folded into `signals_detected` because the two say opposite things about health: a scan that detected nine signals and filed none because all nine were already open is working perfectly, and must not read as a scan that found nothing. No tenant (PostHog is not tenant-partitioned, so a scan is platform-wide) and no soft delete (append-only history) |

**What UX Signals writes, and what it deliberately cannot.** A scan files bug-shaped items as
`bug_findings` rows (`source='ux_signal'`, `status='new'`, `repo='ally-web'`) and improvement-shaped
ones as `analytics_suggestions` rows (`source='ux_signal'`, `status='pending'`). It writes through raw
repositories rather than importing `BugHunterModule` — the same cross-domain pattern
`RoadmapOpportunityService.create` uses, which is why `BugHunterModule` registers `BugFinding` in
`forFeature`. **Nothing in the pipeline can approve a fix, dispatch a session or file a roadmap
opportunity**: both destinations keep their existing human gates.

The suggestion side's "is this title already pending?" check and its insert run inside one
transaction holding **advisory lock `(4920, 1)`** (`pg_advisory_xact_lock`, namespace distinct from
`ScheduledTaskRunnerService`'s 4919). Scans are serialised by `uq_ux_signal_scans_single_running`,
but not absolutely — a scan outliving the 15-minute staleness cutoff is declared abandoned and a
second starts beside it — and without the lock both passes read an empty pending queue and file the
same card. A lock rather than a unique index because `analytics_suggestions` is the *shared* review
queue: the analytics-window producer writes to it too, and historical rows may already hold repeated
titles that a new constraint would turn into a hard error.

**`ux_signal` findings carry no `file`.** Their stable coordinate is a route or control, passed as
`symbol` (`"<route>|<target>"`) precisely so they take `dedupe_key`'s exact path rather than its
description-fingerprint fallback — a daily scan over LLM-written prose is the fastest possible way to
rediscover the duplicate-row problem migration `1910000000000` fixed. `repo` is set outright rather
than left to `BugHunterRepoClassifierService`: every event a detector reads comes from the helpline
frontend, so the answer is known from the provenance of the data. `proven` stays **false** — these
never pass the sweep's adversarial verify phase, and claiming a verification that did not happen would
misrepresent them to whoever decides to act.

**PII.** PostHog persons carry email and name (the frontends pass them to `identify`), so detectors
select event properties and aggregates only; `person_id` appears solely inside `uniq()` to count
breadth. Sample rows are scrubbed of email- and phone-shaped text before they reach a prompt, a
findings row or the admin UI, and helpline search **query text is never captured at all** —
`search_performed` sends `query_length` and `result_count`, which costs the pipeline the ability to say
*which* searches fail and is the right trade for this data.

**Cost telemetry:** one triage call per scan, recorded to `llm_usage` under `LlmTask.UX_SIGNALS`.
Window-run generation records under `LlmTask.ANALYTICS_SUGGESTIONS`.

> ⚠️ The `CHECK` constraints on both tables are hand-written (varchar + CHECK, not Postgres enums),
> per the `bug_findings` precedent. TypeORM cannot see them, so `migration:generate` against these
> tables proposes dropping them. Adding a status, trigger or source value means a hand-written
> migration.

---

## 4. Weaviate (vector DB — `ally-ai`)

Defined in `ally-ai/app/core/vector_db/constants.py`; migrations in `ally-ai/app/migrations/`.
Each "collection" stores objects + their embeddings for semantic search / RAG.

| Collection | Properties | Purpose |
|------------|------------|---------|
| `Conversation` | `chat_id` (int), `message` (text), `role` (text), `timestamp` (date) | Embedded conversation turns for semantic recall within the AI agent. Mirrors a subset of Postgres `messages`/session messages, keyed by `chat_id` |
| `ReferenceDocument` | `heading` (text), `content` (text), `category` (text), `tags` (text[]), `tenant_id` (text) | Embedded knowledge-base docs for RAG. Mirror of Postgres `reference_documents`, scoped by `tenant_id` |
| `KnowledgeChunk` | `document_id`, `document_title` (denormalised), `chunk_index`, **`text`**, `char_start`/`char_end`, `page_from`/`page_to`, `section_path`, `source_url`, `language`, `tags` (text[]), `token_count`, `text_hash`, `embedding_model`/`embedded_at` | Chunked corpus for the WhatsApp Q&A bot (§3.11). Object UUID **is** `kb_document_chunks.id`. Stores `text`, unlike `RoadmapOpportunity` — the retrieve→generate loop runs inside ally-ai in one call, so without it every question would need a back-call to ally-be. **No `tenant_id` on purpose**: a future private per-tenant corpus is a NEW collection, not a filter bolted onto a shared one |
| `MigrationHistory` | `version`, `name`, `description`, `status`, `created_at`, `completed_at` | Internal — tracks applied Weaviate migrations |

**Cross-store link:** `KnowledgeChunk` object UUID ≡ `kb_document_chunks.id` (the one place the two
stores share a key rather than matching on content); `Conversation.chat_id` ↔ `chats.id`; `ReferenceDocument` ↔ `reference_documents`
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
> **Crashed vs. finished sessions.** `ABANDONED` (added 2026-08, migration
> `1932000000000`) exists because the two used to be indistinguishable. It is written
> in two places: `RoomFinishedHandler` sets `event_status = ABANDONED` when the LiveKit
> room closed while the session was still live (nobody ended it), and the hourly
> stuck-session sweeper sets `status = ABANDONED` on rows left ACTIVE for over six
> hours. Both are **analytics-neutral by construction** — `status = ABANDONED` is only
> written over `ACTIVE` and every analytics query filters `status = 'ENDED'`;
> `event_status = ABANDONED` is only written over `IN_PROGRESS` and those queries filter
> `= 'COMPLETED'`. There is deliberately **no backfill**: a historical
> ENDED/IN_PROGRESS row is also what a normal session looks like when the agent's
> `end-of-session` message never arrived, so classifying it after the fact would
> manufacture crashes that never happened.

- **LiveKit** (`src/livekit/`): real-time audio/video rooms. `scenario_sessions.room_id`
  ties a session to its room; egress recordings land in S3 and are referenced by
  `scenario_session_recording.egress_id` + `storage_key`.

---

## 6. "Where do I find…?" quick index

| I need… | Look at |
|---------|---------|
| A user / their org | `users`, `tenants`, `admin_tenants` |
| Who can do/see what | `groups`, `permissions`, `group_permissions`, `user_groups`, `*_tenants`, `*_groups` join tables |
| Which of a tenant's *own users* may see a given course/case/simulation | `tenant_cohorts`, `tenant_cohort_members`, `*_cohort_restrictions` — remember absence of a restriction row means visible tenant-wide |
| Which admin tabs/features a platform admin can see | `admin_feature_toggles` |
| A training simulation run + its score | `scenario_sessions` (+ `_details`, `_messages`, `_events`, `_feedbacks`) |
| Per-turn AI latency / performance | `scenario_session_turn_metrics` |
| Character-library interview-agent conversations | `character_interview_sessions`, `character_interview_messages` |
| Simulation start latency (time to first word) | `scenario_session_start_metrics` |
| Live coaching hints shown during a roleplay | `scenario_session_supervisor_notes` |
| What the supervisor carries about a learner between debriefs | `learner_supervisor_memory` |
| Learner progress through curriculum | `scenario_path_sessions` / `_items`, `case_sessions` / `_items` |
| A real client chat/call + transcript | `chats`, `messages`, `call_details` |
| Daily activity / engagement for analytics | `user_daily_scores`, `badge_users` |
| Analytics dashboard config | `dashboards` (current), `dashboard` (legacy) |
| An internal roadmap idea or bug + its votes | `roadmap_opportunities`, `roadmap_allocations` (score is `SUM(votes)`, never a column) |
| Which month an idea or bug is planned for | `roadmap_opportunities.plannedMonth` + `boardPosition` — but the lane shown is `effectiveMonthOf()`, which prefers `releasedAt` once shipped |
| What the WhatsApp bot can answer from | `kb_documents`, `kb_document_chunks` (+ Weaviate `KnowledgeChunk`) |
| What a worker asked the bot and what it replied | `wa_conversations`, `wa_messages` (bodies blanked past `retentionDays`) |
| Why the bot declined a question | `wa_unanswered_questions` — `reason` + `top_similarity`/`hit_count` |
| The bot's crisis / opt-out / command replies | `wa_keyword_templates` (`mandatory` rows cannot be deleted or disabled) |
| The bot's thresholds, copy and kill switch | `global_settings` row `name='whatsapp_bot'` — not a table |
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
  (**201** at this reconcile, after the 9 Roleplay Studio v2 entities were removed —
  the previous note said 120, which had drifted badly).
