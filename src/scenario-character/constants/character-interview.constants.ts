// Per-session interview turn mutex (SET NX EX) — serializes concurrent
// /messages/stream calls so parallel turns can't interleave tool loops.
export const CHARACTER_INTERVIEW_TURN_LOCK_PREFIX = 'character-interview-turn';

// Lock TTL: a turn is one question or the final draft generation — minutes,
// not tens of minutes.
export const CHARACTER_INTERVIEW_TURN_LOCK_TTL_SECONDS = 5 * 60;

// SSE keep-alive (same rationale as the copilot: proxies drop idle streams).
export const CHARACTER_INTERVIEW_SSE_PING_INTERVAL_MS = 15_000;

/**
 * Output cap for one interview model pass.
 *
 * Sized for `save_character_draft`, which is the whole point of the session
 * and cannot be split: one call carries the profile text, the style samples
 * and every knowledge source at once, and a call cut off at the cap is
 * discarded whole — twenty-odd turns of interview reaching the model and no
 * character coming back. At 8192 a normally rich character (2500-char
 * profile, ~20 style samples, a dozen knowledge sources) sat right on the
 * line. The truncation handler in the orchestrator still exists because a
 * bigger cap moves the cliff rather than removing it: the schema permits
 * fifty 2500-char sources, which no cap accommodates.
 */
export const CHARACTER_INTERVIEW_MAX_TOKENS = 24_000;

/**
 * How many times one turn may be cut off at the cap before it gives up and
 * says so. Each retry tells the model it was truncated and asks it to write a
 * tighter draft; a third attempt that still overruns needs a person.
 */
export const CHARACTER_INTERVIEW_MAX_TRUNCATION_RETRIES = 2;

/**
 * How many times one turn may come back with an unreadable tool call before it
 * gives up.
 *
 * Gemini returns `MALFORMED_FUNCTION_CALL` intermittently against a tool
 * schema this size — measured at roughly one call in three on
 * gemini-2.5-flash with the interview tools. It is transient and carries no
 * partial result, so the fix is to send the identical request again rather
 * than to tell the model anything: two retries put a turn's odds past 95%.
 */
export const CHARACTER_INTERVIEW_MAX_INVALID_TOOL_CALL_RETRIES = 2;

/**
 * Per-tenant interview caps. These bound LLM spend now that the agent is
 * reachable by customer admins and not just Ally staff — a platform admin is
 * not capped.
 *
 * Concurrency is the guard against a runaway client (or an impatient user
 * hammering "new interview"); the monthly ceiling is the guard against steady
 * over-use. An interview is a ~20-25 turn conversation, so a handful in flight
 * at once across an org is already generous, and a hundred a month is far more
 * characters than an org realistically builds.
 */
export const CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT = 5;
export const CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH = 100;

// Prompt registry code (src/prompts/character_interview/interviewer_system.txt).
export const CHARACTER_INTERVIEW_PROMPT_DIR = 'character_interview';
export const CHARACTER_INTERVIEW_PROMPTS = {
  INTERVIEWER_SYSTEM: 'character_interview_interviewer_system',
} as const;
