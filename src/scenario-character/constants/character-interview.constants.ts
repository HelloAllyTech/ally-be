// Per-session interview turn mutex (SET NX EX) — serializes concurrent
// /messages/stream calls so parallel turns can't interleave tool loops.
export const CHARACTER_INTERVIEW_TURN_LOCK_PREFIX = 'character-interview-turn';

// Lock TTL: a turn is one question or the final draft generation — minutes,
// not tens of minutes.
export const CHARACTER_INTERVIEW_TURN_LOCK_TTL_SECONDS = 5 * 60;

// SSE keep-alive (same rationale as the copilot: proxies drop idle streams).
export const CHARACTER_INTERVIEW_SSE_PING_INTERVAL_MS = 15_000;

export const CHARACTER_INTERVIEW_MAX_TOKENS = 8192;

// Prompt registry code (src/prompts/character_interview/interviewer_system.txt).
export const CHARACTER_INTERVIEW_PROMPT_DIR = 'character_interview';
export const CHARACTER_INTERVIEW_PROMPTS = {
  INTERVIEWER_SYSTEM: 'character_interview_interviewer_system',
} as const;
