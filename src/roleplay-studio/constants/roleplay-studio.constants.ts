// FROZEN dispatch contract: rooms for v2 sessions are `roleplay-<uuid>`.
export const ROLEPLAY_ROOM_ID_PREFIX = 'roleplay-';

// FROZEN dispatch contract: inline the compiled spec in LiveKit room metadata
// when its serialized size is under this budget; otherwise send a specFetch
// pointer at the api-key-guarded spec-version webhook.
export const ROLEPLAY_SPEC_INLINE_MAX_BYTES = 55 * 1024;

// Spec structural bounds (FROZEN contract).
export const SPEC_MIN_STATES = 3;
export const SPEC_MAX_STATES = 6;

// Prompt registry codes (src/prompts/roleplay_copilot/*.txt).
export const ROLEPLAY_COPILOT_PROMPT_DIR = 'roleplay_copilot';
export const ROLEPLAY_COPILOT_PROMPTS = {
  INTERVIEWER_SYSTEM: 'roleplay_copilot_interviewer_system',
  INFERENCE_PASS: 'roleplay_copilot_inference_pass',
  SPEC_COMPILER: 'roleplay_copilot_spec_compiler',
  // Iteration mode: reason over live-test feedback and patch the right parts
  // of an already-built spec (see CopilotSessionMode.ITERATING).
  ITERATION_SYSTEM: 'roleplay_copilot_iteration_system',
} as const;

export const COPILOT_MAX_TOKENS = 8192;
