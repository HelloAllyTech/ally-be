/**
 * Canonical taxonomy of LLM "tasks" (operation types) for token-consumption
 * analytics. This is the CROSS-REPO CONTRACT: the Python services (ally-ai,
 * ally-ai-learn) send these exact strings on the `llm_usage` SQS message, and
 * the in-process ally-be call sites (autofill / translation) use them directly.
 *
 * The `task` column on `llm_usage` stores the raw string. `UNKNOWN` is the
 * fallback the processor records when a sender emits a task that is not yet in
 * this enum, so a new Python task type degrades gracefully (one bucket) rather
 * than dropping the row.
 */
export enum LlmTask {
  // Live conversational agent (ally-ai-learn) — highest volume.
  AGENT_TURN = 'agent_turn',
  // Episodic-memory summarizer in ally-ai-learn (rolling-summary compaction
  // during the session + the end-of-session final fold).
  ROLLING_SUMMARY = 'rolling_summary',
  // Live supervisor notes in ally-ai-learn: one call per committed learner
  // turn, deciding whether to send the learner a coaching hint mid-session.
  // Its own label because it runs at agent_turn frequency on a deliberately
  // cheaper model, so folding it into AGENT_TURN would distort both figures.
  SUPERVISOR_NOTE = 'supervisor_note',
  // Client working memory in ally-ai-learn: one detached call per learner turn
  // deriving the actor's inner state (stance, affect, ledgers). Same cadence as
  // AGENT_TURN but off the reply path, so it has to be separable from turn cost
  // for the feature's spend to be arguable against its benefit.
  CLIENT_WORKING_MEMORY = 'client_working_memory',
  // Track-level memory consolidation in ally-be: folds per-session memories
  // into one evolving learner memory per track enrollment.
  TRACK_MEMORY_FOLD = 'track_memory_fold',

  // ally-ai post-/in-session operations.
  NUDGE = 'nudge',
  SUMMARY = 'summary',
  DYNAMIC_SUMMARY = 'dynamic_summary',
  SCENARIO_EVALUATION = 'scenario_evaluation',
  COUNSELOR_ANALYSIS = 'counselor_analysis',
  USER_IDENTIFICATION = 'user_identification',
  CONTENT_ENHANCE = 'content_enhance',
  TAG_POSITIVITY = 'tag_positivity',
  DIARIZATION = 'diarization',
  EMBEDDING = 'embedding',
  DRIFT_JUDGE = 'drift_judge',
  LANGUAGE_JUDGE = 'language_judge',
  // Thinking-filler judge in ally-ai: scores whether a filler sounded like the
  // character and fitted the turn. Its own label rather than folded into
  // LANGUAGE_JUDGE because it runs on a different cadence over a different
  // slice — sharing one would make both lines unreadable.
  FILLER_JUDGE = 'filler_judge',
  // RAG-quality judge in ally-ai: labels whether the passages a corpus
  // retrieval returned actually answered the query, and what a short retrieval
  // was missing. Its own label because the unit is a retrieval rather than a
  // session — far more rows, each a fraction of the tokens — so folded into
  // another judge's line it would swamp the count and dilute the cost.
  RAG_QUALITY_JUDGE = 'rag_quality_judge',
  // Recall-quality judge in ally-ai: did the voice agent's client recall the
  // backstory fact the turn called for, or was it ranked below the cap of five?
  // Its own label because the unit is a TURN — a 30-turn session produces 30
  // calls — so folded into another judge's line it would swamp every count.
  RECALL_QUALITY_JUDGE = 'recall_quality_judge',
  // Analytics Agent (admin Analytics -> Analytics Agent tab): one planning call
  // (question -> SQL) and one narration call (rows -> answer) per question.
  // Separate labels because the planner carries the whole schema catalogue and
  // the narrator carries result rows, so their token profiles differ.
  ANALYTICS_AGENT_PLAN = 'analytics_agent_plan',
  ANALYTICS_AGENT_ANSWER = 'analytics_agent_answer',
  // Analytics Suggestions (admin Analytics -> Suggestions tab): one call per
  // Generate run. Its own label because the profile is unlike anything else
  // here — a whole analytics window in, at most ten suggestions out.
  ANALYTICS_SUGGESTIONS = 'analytics_suggestions',
  // UX Signals scan (src/ux-signals): one triage call per scan, turning
  // threshold-crossing PostHog signals into bug findings and suggestions. Its
  // own label because the input is telemetry aggregates rather than an
  // analytics window, so its token profile tracks detector count, not date range.
  UX_SIGNALS = 'ux_signals',
  // Mobile Releases admin page (src/mobile-releases): one call per
  // ios-whats-new-suggestion request, turning raw ally-mobile commit
  // subjects since the last release into a draft App Store "What's New"
  // text. Its own label because the input is a short commit list, not an
  // analytics window or telemetry aggregate.
  MOBILE_RELEASE_WHATS_NEW = 'mobile_release_whats_new',

  // ally-be studio operations (in-process).
  AUTOFILL_FIELD = 'autofill_field',
  AUTOFILL_ENHANCE_FIELD = 'autofill_enhance_field',
  // Agent Builder Copilot: one parallel per-field generation call.
  AUTOFILL_AGENT_FIELD = 'autofill_agent_field',
  // Character-library interview agent: one streamed interviewer/tool-loop
  // turn building a character profile.
  CHARACTER_INTERVIEW = 'character_interview',
  // Builder: one streamed PRD-interview turn (the coding half's usage is
  // reported by the runner and recorded against BUILDER_BUILD).
  BUILDER_INTERVIEW = 'builder_interview',
  BUILDER_BUILD = 'builder_build',
  // The flywheel's cheap passes: folding retrospective bullets into the
  // curated lesson set, categorising how a build actually turned out, and
  // picking which past lessons/exemplars a new session should see.
  BUILDER_LESSON_CURATION = 'builder_lesson_curation',
  BUILDER_OUTCOME_CATEGORISE = 'builder_outcome_categorise',
  BUILDER_CONTEXT_SELECTION = 'builder_context_selection',
  // Cutting a large PRD into independently shippable milestones.
  BUILDER_EPIC_DECOMPOSITION = 'builder_epic_decomposition',
  // The interview's one-shot research pass over the codebase.
  BUILDER_RESEARCH = 'builder_research',
  // Bounding interview context growth by summarising older turns.
  BUILDER_INTERVIEW_SUMMARY = 'builder_interview_summary',
  // Track 2.0 quiz: grading one open-ended learner answer against its rubric.
  TRACK_QUIZ_GRADING = 'track_quiz_grading',
  TRANSLATE_SCENARIO = 'translate_scenario',
  // Admin-dashboard scenario cover-image generation (Simulation Studio).
  GENERATE_COVER_IMAGE = 'generate_cover_image',
  TRANSLATE_TEXT = 'translate_text',
  TRANSLATE_OBJECT = 'translate_object',
  // Scribe voice note: turning one dictation transcript into note fields.
  // Previously recorded NO usage row at all — the call went straight to the
  // Anthropic SDK and skipped the sink — so scribe dictation cost was
  // invisible. Labelled now that it resolves through LlmCompletionService.
  VOICE_NOTE_EXTRACT = 'voice_note_extract',
  // AI Lab: one run of a saved skill against its chosen model. Also recorded
  // nothing before; the AI Lab's own run rows tracked cost, so it was absent
  // from platform-wide LLM spend.
  AI_LAB_RUN = 'ai_lab_run',
  // LLM Preview: one 32-token round trip proving a model still answers.
  // Individually trivial, but the monthly liveness sweep runs it across the
  // whole catalog, so it is worth being able to see rather than inferring it
  // from a gap in the numbers.
  LLM_PREVIEW = 'llm_preview',

  // STT (speech-to-text) tasks.
  AGENT_STT = 'agent_stt', // live agent listening (per turn)
  TRANSCRIPTION = 'transcription', // batch uploaded-audio transcription

  // TTS (text-to-speech) tasks.
  AGENT_TTS = 'agent_tts', // live agent voice (per turn)

  // Bug Hunter: any LLM call inside the autonomous find-and-fix pipeline
  // (finder classification, adversarial verify, fix drafting, doc sync).
  // One label across every stage — see BugHunterService.snapshotCostUsd,
  // which sums llm_usage by this task tagged with metadata.runId to cost a
  // run, not by stage within it.
  BUG_HUNTER = 'bug_hunter',

  // Fallback for an un-mapped sender task (never drop a usage row).
  UNKNOWN = 'unknown',
}
