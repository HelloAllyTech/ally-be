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
 * How long the interviewer's system prompt is memoised.
 *
 * It was re-read from the database and the filesystem on every turn. A minute
 * of staleness after someone edits the prompt is nobody's problem; the turn
 * latency is what a person actually waits through.
 */
export const BUILDER_SYSTEM_PROMPT_TTL_MS = 60_000;

/**
 * Output cap for one interview model pass, deliberately larger than the
 * shared cap above.
 *
 * The interview writes the PRD through `update_prd`, and a tool call is
 * all-or-nothing: a patch cut off at the cap is discarded whole, so the cap
 * is not a budget here, it is a cliff. A turn that writes requirements, the
 * technical plan and the test plan together runs past 8k comfortably, and
 * every such turn used to end with the agent announcing the write and the
 * document not moving. The truncation handler below still exists because a
 * bigger cap moves the cliff rather than removing it.
 */
export const BUILDER_INTERVIEW_MAX_TOKENS = 16_000;

/**
 * How many times one turn may be cut off at the output cap before it gives
 * up and says so. Each retry tells the model what happened and asks it to
 * split the write; a third attempt that still overruns is not going to be
 * fixed by a fourth.
 */
export const BUILDER_MAX_TRUNCATION_RETRIES = 2;

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

/* ── Mid-run budget hold ────────────────────────────────────────────────── */

/**
 * How long a run that has hit its ceiling waits at a phase boundary for
 * somebody to raise the budget before it gives up.
 *
 * Waiting is cheaper than aborting, which is the whole reason this exists.
 * Nothing a run writes is pushed before FINALISE, so a budget abort throws
 * away the entire working tree — an hour of coding and every dollar that
 * bought it — and the retry starts from the PRD again. Holding a runner idle
 * costs GitHub minutes and no tokens at all, so twenty minutes of waiting is
 * a rounding error against re-running the phase that just burned $16.
 *
 * Twenty minutes rather than sixty: it has to be long enough for the
 * notification to reach whoever is watching, and short enough that an
 * abandoned build releases its runner well inside the workflow's own
 * `timeout-minutes: 120`.
 */
export const BUILDER_BUDGET_HOLD_SECONDS = 20 * 60;

/**
 * How often a held run re-reads the ceiling. Fifteen seconds so a raise feels
 * immediate to the person who just made it — the poll is one indexed read and
 * the runner is otherwise doing nothing.
 */
export const BUILDER_BUDGET_HOLD_POLL_SECONDS = 15;

/**
 * How big a build is, which decides what it is worth spending on planning it.
 *
 * The planner was a fixed Opus pass with 60 turns and no output ceiling
 * regardless of what it was planning. On the first real build — two routes and
 * a checkbox — it spent $7.85 and 19 minutes producing a 29 KB plan, then that
 * plan rode in the coder's prompt and was re-read on all 148 of its turns.
 *
 * Sized from the PRD rather than guessed at, because the PRD is the only
 * statement of scope that exists before the work starts.
 */
export enum BuilderBuildSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
}

/**
 * Per-size planning budget.
 *
 * `planWords` is advisory and goes in the prompt; `maxTurns` and `maxBudgetUsd`
 * are enforced by the runner, so a planner that ignores the advice still cannot
 * run away with the session.
 */
export const BUILDER_SIZE_PROFILES: Record<
  BuilderBuildSize,
  {
    plannerTier: 'coder' | 'planner';
    effort: 'low' | 'medium' | 'high';
    maxTurns: number;
    planWords: number;
    maxBudgetUsd: {
      plan: number;
      code: number;
      verify: number;
      finalise: number;
    };
  }
> = {
  // A small build does not need an Opus plan; it needs the coder to start.
  [BuilderBuildSize.SMALL]: {
    plannerTier: 'coder',
    effort: 'low',
    maxTurns: 20,
    planWords: 800,
    maxBudgetUsd: { plan: 2, code: 8, verify: 3, finalise: 3 },
  },
  [BuilderBuildSize.MEDIUM]: {
    plannerTier: 'planner',
    effort: 'medium',
    maxTurns: 40,
    planWords: 1500,
    maxBudgetUsd: { plan: 5, code: 12, verify: 4, finalise: 4 },
  },
  // Unchanged from the behaviour every run used to get.
  [BuilderBuildSize.LARGE]: {
    plannerTier: 'planner',
    effort: 'high',
    maxTurns: 60,
    planWords: 3000,
    maxBudgetUsd: { plan: 10, code: 20, verify: 6, finalise: 5 },
  },
};

/**
 * How much technical plan a PRD actually carries.
 *
 * `technicalPlan` is an object ({repos:[{repo,changesMd}], dataModelMd, apiMd}),
 * so stringifying it gives "[object Object]" — 15 characters no matter how
 * detailed the plan is, which would have made every PRD look small.
 */
export function prdTechnicalPlanLength(draft: Record<string, any>): number {
  const plan = draft?.technicalPlan;
  if (!plan) return 0;
  if (typeof plan === 'string') return plan.length;

  const repoPlans = Array.isArray(plan.repos) ? plan.repos : [];
  return (
    repoPlans.reduce(
      (total: number, entry: any) =>
        total + String(entry?.changesMd ?? '').length,
      0,
    ) +
    String(plan.dataModelMd ?? '').length +
    String(plan.apiMd ?? '').length
  );
}

/**
 * Classify a PRD.
 *
 * Requirements times repos, because cross-repo work is where planning earns its
 * keep: a contract that spans ally-be and ally-web is the case a coder gets
 * wrong without a plan. Epic mode is always large — it was decomposed precisely
 * because it was too big to hold at once.
 */
export function classifyBuildSize(input: {
  requirementCount: number;
  repoCount: number;
  technicalPlanLength: number;
  isEpic?: boolean;
}): BuilderBuildSize {
  if (input.isEpic) return BuilderBuildSize.LARGE;

  const spread =
    Math.max(1, input.requirementCount) * Math.max(1, input.repoCount);
  if (spread >= 24 || input.technicalPlanLength >= 6000) {
    return BuilderBuildSize.LARGE;
  }
  if (
    (input.requirementCount <= 4 && input.repoCount <= 1) ||
    (spread <= 8 && input.technicalPlanLength < 2000)
  ) {
    return BuilderBuildSize.SMALL;
  }
  return BuilderBuildSize.MEDIUM;
}
