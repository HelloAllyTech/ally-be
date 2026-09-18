# Database ERD

Auto-derived from the 192 `src/**/entity/*.entity.ts` files (180 concrete tables + 12 abstract
base classes). This repo declares almost no TypeORM relation decorators — associations live as
plain `*Id` columns, so the edges below are inferred from column naming and are **not** enforced
FK constraints in every case. `DATA_SCHEMA.md` remains the authoritative per-column reference.

Reading the diagrams:

- `||--o{` = one-to-many, `}o--o{` = join/many-to-many, `||--o|` = optional one-to-one.
- Nearly every table also carries `tenant_id` → `tenants`. That edge is drawn only in the
  **Tenancy & access** diagram; assume it everywhere else rather than reading 180 lines of it.
- Not foreign keys despite the `*Id` suffix: `roomId` (LiveKit room string), `externalId`
  (Auth0/upstream id), `correlationId`, `invocationId`, `egressId`, `providerMessageId`,
  `lastJobId`, `patchId`.

---

## 1. Tenancy, users & access control

```mermaid
erDiagram
    tenants ||--o{ users : "tenant_id"
    tenants ||--o{ admin_tenants : ""
    tenants ||--o{ tenant_cohorts : ""
    tenants ||--o{ scenario_tenants : ""
    tenants ||--o{ track_tenants : ""
    tenants ||--o{ case_tenants : ""
    tenants ||--o{ scenario_path_tenants : ""
    tenants ||--o{ roleplay_spec_tenants : ""
    tenants ||--o{ badge_tenants : ""
    tenants ||--o{ dashboard_tenants : ""
    tenants ||--o{ variety_profile_attachments : ""

    users ||--o{ admin_tenants : ""
    users ||--o| user_preferences : ""
    users ||--o{ user_groups : ""
    users ||--o{ admin_feature_toggles : ""
    users ||--o{ audit_logs : ""
    users ||--o{ user_daily_scores : ""
    users ||--o{ simulation_credits : ""
    users ||--o{ tenant_cohort_members : ""

    groups ||--o{ user_groups : ""
    groups ||--o{ group_permissions : ""
    permissions ||--o{ group_permissions : ""
    groups ||--o{ badge_groups : ""
    groups ||--o{ dashboard_groups : ""

    tenant_cohorts ||--o{ tenant_cohort_members : ""
    tenant_cohorts ||--o{ scenario_cohort_restrictions : ""
    tenant_cohorts ||--o{ track_cohort_restrictions : ""
    tenant_cohorts ||--o{ case_cohort_restrictions : ""

    badges ||--o{ badge_users : ""
    badges ||--o{ badge_groups : ""
    badges ||--o{ badge_tenants : ""
    users ||--o{ badge_users : ""
```

> A user's role is `user_groups` → `groups` → `group_permissions`; there is no `role` column.

---

## 2. Scenarios & versioning (`src/learn`)

```mermaid
erDiagram
    scenarios ||--o{ scenario_versions : "scenarioId"
    scenario_versions ||--o{ scenario_versions : "parentVersionId"
    scenarios ||--o| scenario_versions : "publishedVersionId"
    competencies ||--o{ scenarios : "competencyId / competencyIds[]"
    roleplay_specs ||--o| scenarios : "roleplaySpecId"

    scenarios ||--o{ scenario_translations : ""
    scenarios ||--o{ scenario_tenants : ""
    scenarios ||--o{ scenario_events : ""
    scenarios ||--o{ scenario_behavior_instructions : ""
    scenarios ||--o{ scenario_trigger_warnings : ""
    scenarios ||--o{ scenario_cohort_restrictions : ""

    competencies ||--o{ competency_behaviors : ""
    behaviors ||--o{ competency_behaviors : ""
    behaviors ||--o{ behavior_translations : ""
    behaviors ||--o{ scenario_behavior_instruction_behaviors : ""
    scenario_behavior_instructions ||--o{ scenario_behavior_instruction_behaviors : ""
    scenario_behavior_instructions ||--o{ scenario_behavior_instruction_translations : ""

    session_events ||--o{ scenario_events : "eventId"
    session_events ||--o{ session_events_translations : ""
    scenario_events ||--o{ scenario_events_translations : ""
    trigger_warnings ||--o{ scenario_trigger_warnings : ""

    languages ||--o{ scenario_translations : ""
    languages ||--o{ behavior_translations : ""
    languages ||--o{ scenario_events_translations : ""
    languages ||--o{ scenario_behavior_instruction_translations : ""
    languages ||--o{ session_events_translations : ""

    scenario_characters }o--o{ scenarios : "voiceId / scenario_voices"
    character_interview_sessions ||--o{ character_interview_messages : "sessionId"
```

---

## 3. Scenario sessions — the runtime hub

`scenario_sessions` is the single most referenced table (20 tables carry `scenarioSessionId`).

```mermaid
erDiagram
    scenarios ||--o{ scenario_sessions : "scenarioId"
    scenario_versions ||--o{ scenario_sessions : "scenarioVersionId"
    users ||--o{ scenario_sessions : "counselorId"
    scenario_path_session_items ||--o| scenario_sessions : ""
    case_session_items ||--o| scenario_sessions : ""
    track_item_progress ||--o| scenario_sessions : ""

    scenario_sessions ||--o| scenario_session_details : ""
    scenario_sessions ||--o{ scenario_session_messages : ""
    scenario_sessions ||--o{ scenario_session_events : ""
    scenario_sessions ||--o{ scenario_session_feedbacks : ""
    scenario_sessions ||--o{ scenario_session_lifecycle_events : ""
    scenario_sessions ||--o{ scenario_session_behavior_instructions : ""
    scenario_sessions ||--o{ scenario_session_recordings : ""
    scenario_sessions ||--o| scenario_session_start_metrics : ""
    scenario_sessions ||--o{ scenario_session_turn_metrics : ""
    scenario_sessions ||--o{ scenario_session_chats : ""
    scenario_sessions ||--o{ scenario_session_message_tags : ""
    scenario_sessions ||--o{ llm_usage : ""
    scenario_sessions ||--o{ glossary_adherence_reports : ""
    scenario_sessions ||--o{ roleplay_rubric_scores : ""
    scenario_sessions ||--o{ roleplay_director_events : ""
    scenario_sessions ||--o{ scenario_session_reviews : ""

    scenario_session_messages ||--o{ scenario_session_message_tags : "messageId"
    scenario_session_tags ||--o{ scenario_session_message_tags : "tagId"
    scenario_session_messages ||--o{ scenario_session_message_translations : ""
    scenario_session_events }o--|| session_events : "eventId"
    scenario_session_behavior_instructions }o--|| scenario_behavior_instructions : ""
    scenario_session_chats ||--o{ scenario_session_chat_messages : "chatId"
    users ||--o{ scenario_session_chats : "userId"
    users ||--o{ scenario_session_messages : "senderId"
    users ||--o| learner_supervisor_memory : "counselorId"
    scenario_sessions ||--o| learner_supervisor_memory : "lastScenarioSessionId"
```

### Judgments & evaluation over sessions

```mermaid
erDiagram
    scenario_sessions ||--o{ language_judgment_sessions : ""
    scenario_sessions ||--o{ turn_drift_judgment : ""
    scenario_sessions ||--o{ feedback_claim_judgment : ""
    language_judgment_sessions ||--o{ language_error_annotations : "sessionJudgmentId"
    scenario_sessions ||--o{ language_error_annotations : ""
    scenarios ||--o{ language_judgment_sessions : ""
    scenario_versions ||--o{ language_judgment_sessions : ""
    scenarios ||--o{ turn_drift_judgment : ""
    scenario_versions ||--o{ turn_drift_judgment : ""
    scenarios ||--o{ feedback_claim_judgment : ""
    scenario_versions ||--o{ feedback_claim_judgment : ""

    scenarios ||--o{ scenario_reports : ""
    scenario_versions ||--o{ scenario_reports : ""
    scenario_reports ||--o{ scenario_report_transcripts : ""
```

### Session review threads (mirrored for scribe sessions)

```mermaid
erDiagram
    scenario_sessions ||--o{ scenario_session_reviews : ""
    scenario_session_reviews ||--o{ scenario_session_review_threads : ""
    scenario_session_review_threads ||--o{ scenario_session_review_comments : ""
    scenario_session_review_comments ||--o{ scenario_session_review_comment_reactions : ""
    scenario_session_reviews ||--o{ scenario_session_review_reactions : ""
    scenario_session_reviews ||--o{ scenario_session_review_read_status : ""

    scribe_session_reviews ||--o{ scribe_session_review_threads : ""
    scribe_session_review_threads ||--o{ scribe_session_review_comments : ""
    scribe_session_review_comments ||--o{ scribe_session_review_comment_reactions : ""
    scribe_session_reviews ||--o{ scribe_session_review_reactions : ""
    scribe_session_reviews ||--o{ scribe_session_review_read_status : ""
```

> Both review trees extend the abstract `src/review/entity/base-review*.entity.ts` classes; the
> parent-child columns (`reviewId`, `threadId`, `commentId`) are declared there, not in the
> concrete entities.

---

## 4. Learning containers — tracks, cases, scenario paths

```mermaid
erDiagram
    tracks ||--o{ track_sections : ""
    tracks ||--o{ track_items : ""
    track_sections ||--o{ track_items : "trackSectionId"
    tracks ||--o{ track_enrollments : ""
    tracks ||--o{ track_translations : ""
    tracks ||--o{ track_tenants : ""
    tracks ||--o{ track_cohort_restrictions : ""
    scenarios ||--o| track_items : "scenarioId"
    cases ||--o| track_items : "caseId"

    track_enrollments ||--o{ track_item_progress : "trackEnrollmentId"
    track_items ||--o{ track_item_progress : ""
    users ||--o{ track_enrollments : ""
    users ||--o{ track_item_progress : ""
    track_item_progress ||--o{ track_quiz_attempts : ""
    track_item_progress ||--o{ track_annotation_attempts : ""
    track_item_progress ||--o{ track_journal_entries : ""
    prompts ||--o{ track_journal_entries : "promptId"
    languages ||--o{ track_translations : ""

    cases ||--o{ case_items : ""
    cases ||--o{ case_sessions : ""
    cases ||--o{ case_tenants : ""
    cases ||--o{ case_cohort_restrictions : ""
    scenarios ||--o{ case_items : ""
    case_sessions ||--o{ case_session_items : ""
    case_items ||--o{ case_session_items : ""
    case_sessions ||--o{ track_item_progress : "caseSessionId"
    users ||--o{ case_sessions : ""

    scenario_paths ||--o{ scenario_path_items : ""
    scenario_paths ||--o{ scenario_path_sessions : ""
    scenario_paths ||--o{ scenario_path_tenants : ""
    scenarios ||--o{ scenario_path_items : ""
    scenario_path_sessions ||--o{ scenario_path_session_items : ""
    scenario_path_items ||--o{ scenario_path_session_items : ""
    users ||--o{ scenario_path_sessions : ""
```

---

## 5. Roleplay Studio

```mermaid
erDiagram
    roleplay_specs ||--o{ roleplay_spec_versions : "specId"
    roleplay_specs ||--o| roleplay_spec_versions : "publishedVersionId"
    roleplay_specs ||--o{ roleplay_spec_tenants : ""
    roleplay_specs ||--o{ roleplay_test_runs : ""
    roleplay_specs ||--o{ copilot_sessions : ""
    competencies ||--o{ roleplay_specs : "competencyId / competencyIds[]"
    scenarios ||--o| roleplay_specs : "scenarioId"

    roleplay_spec_versions ||--o{ roleplay_test_runs : "specVersionId"
    roleplay_test_runs ||--o{ roleplay_test_reports : "runId"
    roleplay_test_runs ||--o| roleplay_test_runs : "sourceReportId"
    roleplay_test_reports ||--o| roleplay_test_reports : "improveOfReportId"
    agent_test_cases ||--o{ roleplay_test_reports : ""

    copilot_sessions ||--o{ copilot_messages : "sessionId"
    behaviors ||--o{ roleplay_rubric_scores : "behaviorId"
```

---

## 6. Chat / scribe & telephony

```mermaid
erDiagram
    users ||--o{ chats : "clientId, counselorId"
    chats ||--o{ messages : ""
    chats ||--o| call_details : ""
    chats ||--o{ chat_audio_uploads : ""
    chats ||--o{ chat_summary_attempts : ""
    chats ||--o{ summary_feedback : ""
    chats ||--o{ chat_custom_field_values : ""
    chats ||--o{ queue_entries : ""
    messages ||--o{ messages : "parentMessageId"
    messages ||--o{ feedback : "messageId"
    users ||--o{ messages : "senderId"
    users ||--o{ feedback : ""
    custom_field_definitions ||--o{ chat_custom_field_values : "fieldDefinitionId"
    users ||--o{ queue_entries : "clientId"
```

```mermaid
erDiagram
    wa_contacts ||--o{ wa_conversations : "contactId"
    wa_conversations ||--o{ wa_messages : "conversationId"
    wa_contacts ||--o{ wa_messages : "contactId"
    wa_messages ||--o{ wa_messages : "inReplyToId"
    wa_keyword_templates ||--o{ wa_messages : "templateId"
    wa_messages ||--o{ wa_unanswered_questions : "messageId"
    wa_conversations ||--o{ wa_unanswered_questions : ""
    kb_documents ||--o| wa_unanswered_questions : "linkedDocumentId"
    kb_documents ||--o{ kb_document_chunks : "documentId"
```

---

## 7. Language, glossary & prompts

```mermaid
erDiagram
    languages ||--o{ language_variety_profiles : ""
    languages ||--o{ language_glossary_sections : ""
    languages ||--o{ glossary_consolidation_batches : ""
    languages ||--o{ glossary_adherence_reports : ""
    languages ||--o{ variety_profile_attachments : ""
    language_variety_profiles ||--o{ variety_profile_attachments : "profileId"
    language_variety_profiles ||--o{ language_glossary_sections : "profileId"
    llm_configs ||--o{ languages : "llmConfigId"
    llm_models ||--o{ languages : "llmModelId"
    stt_configs ||--o{ languages : "sttConfigId"

    prompts ||--o{ prompts_versions : "promptId"
    prompts ||--o{ prompt_translations : ""
    prompts_versions ||--o{ prompt_translations : "promptVersionId"
    languages ||--o{ prompt_translations : ""
    tooltips ||--o{ tooltip_translations : ""
    languages ||--o{ tooltip_translations : ""
```

---

## 8. Analytics, Lab & Bug Hunter

```mermaid
erDiagram
    dashboards ||--o{ dashboard_tenants : "dashboardId"
    dashboards ||--o{ dashboard_groups : ""
    users ||--o{ analytics_chart_preferences : ""
    scenario_sessions ||--o{ llm_usage : ""

    lab_runs ||--o{ lab_eval_questions : "runId"
    lab_runs ||--o{ lab_run_assignments : ""
    lab_runs ||--o{ lab_auto_evaluations : ""
    lab_skills ||--o{ lab_runs : "skillId"
    lab_evaluators ||--o{ lab_run_assignments : "evaluatorId"
    lab_run_assignments ||--o{ lab_eval_answers : "assignmentId"
    lab_eval_questions ||--o{ lab_eval_answers : "questionId"
    lab_question_sets ||--o{ lab_question_set_questions : "questionSetId"
    lab_question_sets ||--o{ lab_eval_questions : "sourceQuestionSetId"
    lab_variables ||--o{ lab_values : "variableId"

    bug_hunt_runs ||--o{ bug_findings : "runId"
    bug_hunt_runs ||--o{ bug_hunt_events : ""
    bug_hunt_runs ||--o{ bug_hunter_notifications : ""
    bug_findings ||--o{ bug_findings : "parentFindingId"
    bug_findings ||--o{ bug_hunt_events : "findingId"
    bug_findings ||--o{ bug_hunter_notifications : ""
    analytics_suggestions ||--o{ bug_hunt_events : "suggestionId"

    roadmap_opportunities ||--o{ roadmap_opportunity_comments : "opportunityId"
    roadmap_opportunities ||--o{ roadmap_allocations : ""
    roadmap_opportunities ||--o{ analytics_suggestions : ""
    users ||--o{ roadmap_opportunities : "ownerUserId"
    users ||--o{ roadmap_allocations : ""
    users ||--o{ roadmap_user_tab_order : ""
```

---

## Standalone tables (no `*Id` references either way)

`analytics_quality_thresholds`, `eval_experiments`, `cloud_telephony_integrations`, `blogs`,
`comfort_audio_tracks`, `conversational_guardrails`, `filler_tags`, `learn_room_metadata`,
`places`, `global_settings`, `preferences`, `scenario_cover_image_library`,
`roadmap_opportunity_owners`, `roadmap_saved_views`, `roadmap_product_goals`,
`roadmap_interview_notes`, `bug_hunter_settings`, `reference_documents` (`organizationId` only).
