export const PROCESSOR_EVENT_TYPES = {
  TRANSCRIBE_AND_SUMMARIZE_RESPONSE: 'transcribe_and_summarize_response',
  MESSAGE: 'message',
  EVENT: 'event',
  BEHAVIOR_INSTRUCTION: 'behavior_instruction',
  TURN_METRICS: 'turn_metrics',
  START_METRICS: 'start_metrics',
  LLM_USAGE: 'llm_usage',
  SESSION_MEMORY: 'session_memory',
  UNKNOWN_EVENT: 'UNKNOWN_EVENT',
} as const;
