// Per-session interview turn mutex (SET NX EX) — serializes concurrent
// /messages/stream calls so parallel turns can't interleave tool loops over
// one transcript.
export const BUILDER_TURN_LOCK_PREFIX = 'builder-turn';

// Lock TTL. A turn is one question or one round of PRD writing — minutes.
export const BUILDER_TURN_LOCK_TTL_SECONDS = 5 * 60;

// SSE keep-alive: a turn that spends 40s researching the codebase emits
// nothing, and proxies drop idle streams.
export const BUILDER_SSE_PING_INTERVAL_MS = 15_000;

export const BUILDER_MAX_TOKENS = 8192;

/**
 * Caps on what a single interview tool call may pull into context. These are
 * cost controls first and quality controls second: a whole-file dump crowds
 * out the reasoning space that makes the next question a good one.
 */
export const BUILDER_GITHUB_FILE_MAX_BYTES = 50_000;
export const BUILDER_GITHUB_TREE_MAX_ENTRIES = 400;
export const BUILDER_GITHUB_SEARCH_MAX_RESULTS = 20;

/** Lessons digest size fed into the system prompt. */
export const BUILDER_LESSONS_IN_CONTEXT = 20;

/** Stacks retrieval defaults — small on purpose; hits are compact. */
export const BUILDER_STACKS_DEFAULT_RESULTS = 4;
export const BUILDER_STACKS_MAX_RESULTS = 10;

/**
 * Per-tenant session caps, mirroring the character-interview rationale: bound
 * LLM spend for org admins (a platform admin is not capped). Concurrency
 * guards a runaway client; the monthly ceiling guards steady over-use.
 */
export const BUILDER_MAX_ACTIVE_SESSIONS_PER_TENANT = 5;
export const BUILDER_MAX_SESSIONS_PER_TENANT_PER_MONTH = 50;

/** Title/slug bounds — slug is a git branch component. */
export const BUILDER_TITLE_MAX_LENGTH = 200;
export const BUILDER_SLUG_MAX_LENGTH = 80;

/* ── Build dispatch ─────────────────────────────────────────────────────── */

/** The workflow file, hosted in ally-be — one copy, so it cannot drift. */
export const BUILDER_WORKFLOW_FILE = 'builder-session.yml';
export const BUILDER_WORKFLOW_REPO = 'ally-be';
export const BUILDER_WORKFLOW_REF = 'master';

/**
 * How long a dispatch may go uncorrelated before we call it lost.
 * `workflow_dispatch` answers 204 with no run id, so a run that GitHub never
 * registered is indistinguishable from one it registered slowly — until this
 * elapses.
 */
export const BUILDER_DISPATCH_TIMEOUT_MS = 30 * 60_000;

/**
 * Hard ceiling on a run, deliberately past the workflow's own
 * `timeout-minutes: 120` so the runner gets to fail on its own terms first
 * and report why. Only when even that produces nothing do we time it out.
 */
export const BUILDER_RUN_TIMEOUT_MS = 150 * 60_000;

/** Event payloads are truncated here — stream-json is chatty. */
export const BUILDER_EVENT_PAYLOAD_MAX_BYTES = 8_192;

/** Most events a single pipeline POST may carry. */
export const BUILDER_EVENT_BATCH_MAX = 100;

/** Page size for the event feed. */
export const BUILDER_EVENT_PAGE_SIZE = 500;

/**
 * How much of the previous run's history the resume prompt reconstructs.
 * Condensed state, never a transcript replay: replaying two hundred tool
 * calls would cost more tokens than the work they represent.
 */
export const BUILDER_RESUME_FILES_MAX = 60;
export const BUILDER_RESUME_TEST_OUTPUT_MAX = 4_000;

/** Redis prefix for the per-session dispatch lock. */
export const BUILDER_DISPATCH_LOCK_PREFIX = 'builder-dispatch';
export const BUILDER_DISPATCH_LOCK_TTL_SECONDS = 60;

/** Reconcile cadence key in the scheduled-task registry. */
export const BUILDER_RECONCILE_INTERVAL = '5min';
export const BUILDER_RECONCILE_TASK = 'builder-run-reconcile';

// Prompt registry code (src/prompts/builder/interviewer_system.txt).
export const BUILDER_PROMPT_DIR = 'builder';
export const BUILDER_PROMPTS = {
  INTERVIEWER_SYSTEM: 'builder_interviewer_system',
} as const;
