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

  // ally-be studio operations (in-process).
  AUTOFILL_FIELD = 'autofill_field',
  AUTOFILL_ENHANCE_FIELD = 'autofill_enhance_field',
  AUTOFILL_AGENT_PROMPT = 'autofill_agent_prompt',
  // Agent Builder Copilot V2: one parallel per-field generation call.
  AUTOFILL_AGENT_V2_FIELD = 'autofill_agent_v2_field',
  TRANSLATE_SCENARIO = 'translate_scenario',
  TRANSLATE_TEXT = 'translate_text',
  TRANSLATE_OBJECT = 'translate_object',

  // STT (speech-to-text) tasks.
  AGENT_STT = 'agent_stt', // live agent listening (per turn)
  TRANSCRIPTION = 'transcription', // batch uploaded-audio transcription

  // TTS (text-to-speech) tasks.
  AGENT_TTS = 'agent_tts', // live agent voice (per turn)

  // Fallback for an un-mapped sender task (never drop a usage row).
  UNKNOWN = 'unknown',
}
