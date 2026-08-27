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
 * When the interview transcript starts being summarised, and how much of the
 * recent conversation is always replayed verbatim.
 *
 * Only the system blocks are prompt-cached, so the transcript is re-read at
 * full price every turn — a twenty-turn interview with heavy tool results grows
 * monotonically and costs more each time. Summarising the older half bounds
 * that. The recent window stays verbatim because the last few turns are what
 * the admin is actually responding to, and a summary of "what you just said" is
 * where compression starts doing damage.
 */
export const BUILDER_INTERVIEW_SUMMARY_AFTER_MESSAGES = 40;
export const BUILDER_INTERVIEW_SUMMARY_KEEP_RECENT = 16;

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

/**
 * Hard cap on the curated active lesson set.
 *
 * The cap is the reason curation exists at all: the context a prompt can spend
 * on lessons is fixed, so an unbounded table does not mean more memory — it
 * means the newest twenty crowd out everything learned before them. Sized so
 * the whole active set fits in one re-rank call, which is what lets retrieval
 * skip an index entirely.
 */
export const BUILDER_LESSON_ACTIVE_CAP = 80;

/** Candidates needed before an opportunistic consolidation is worth a call. */
export const BUILDER_LESSON_CANDIDATE_TRIGGER = 10;

/** Past builds offered to a new session as worked examples. */
export const BUILDER_EXEMPLARS_IN_CONTEXT = 2;

/** Exemplars considered before the re-rank picks from them. */
export const BUILDER_EXEMPLAR_CANDIDATES = 24;

/**
 * Milestone bounds for epic mode. Two is the point at which splitting means
 * anything; past six nobody can follow the series, and the review burden the
 * split was meant to reduce comes back as coordination overhead.
 */
export const BUILDER_MILESTONES_MIN = 2;
export const BUILDER_MILESTONES_MAX = 6;

/**
 * Cadence keys for the flywheel's scheduled passes. Both hourly because the
 * scheduler offers no daily tick and both no-op cheaply when idle — the
 * curator on one COUNT, the sweep on one indexed query.
 */
export const BUILDER_CURATE_INTERVAL = 'hourly';
export const BUILDER_CURATE_TASK = 'builder-lesson-curate';
export const BUILDER_OUTCOME_INTERVAL = 'hourly';
export const BUILDER_OUTCOME_TASK = 'builder-outcome-sweep';

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

/* ── Model tiering ──────────────────────────────────────────────────────── */

/**
 * The single source of model defaults, per role in the tiered loop. Env vars
 * (`BUILDER_INTERVIEW_MODEL`, `BUILDER_PLANNER_MODEL`, `BUILDER_CODER_MODEL`,
 * `BUILDER_VERIFIER_MODEL`) override via config; builder_settings overrides
 * per environment; StartBuildDto overrides per run. Nothing else may carry a
 * hard-coded model id — the interview/build default drift this replaces came
 * from four separate literals.
 *
 * Tiering rationale: planning and adversarial verification are where model
 * strength changes the outcome; bulk coding follows a plan; mechanical passes
 * (repo maps, summaries, consolidation) need speed and price, not depth.
 */
export const BUILDER_MODEL_DEFAULTS = {
  interview: 'claude-sonnet-5',
  planner: 'claude-opus-5',
  coder: 'claude-sonnet-5',
  verifier: 'claude-opus-5',
  mechanical: 'claude-haiku-4-5',
} as const;

/* ── The in-run loop (run-engine.sh mirrors these) ─────────────────────── */

/**
 * Most coder invocations per run: the first CODE pass plus remediation
 * rounds fixing gate failures or verifier objections. Past this the run
 * fails with the standing objections as its error — an agent that cannot
 * satisfy the gate and the verifier in four attempts needs a person, not a
 * fifth attempt.
 */
export const BUILDER_MAX_CODE_ITERATIONS = 4;

/** Most fresh-context verifier invocations per run. */
export const BUILDER_MAX_VERIFY_ROUNDS = 3;

/**
 * Tool allowlists per phase. The verifier deliberately gets no Write/Edit/
 * Task: it reviews the tree, it does not touch it (run-engine also
 * hard-reverts any stray write with git after the verifier exits).
 */
export const BUILDER_CODER_TOOLS = 'Bash,Read,Write,Edit,Glob,Grep,Task';
export const BUILDER_PLANNER_TOOLS = 'Bash,Read,Glob,Grep,Task';
export const BUILDER_VERIFIER_TOOLS = 'Bash,Read,Glob,Grep';
