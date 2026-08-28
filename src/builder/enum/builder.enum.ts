/**
 * Builder lifecycle enums.
 *
 * Two levels deliberately, and they are not interchangeable:
 *
 *  - `BuilderSessionStatus` is what ally-be owns and can transition on its
 *    own (an admin starts a build, answers a question, cancels).
 *  - `BuilderStage` is what the *agent* reports from inside a runner. ally-be
 *    only ever learns a stage from an event callback, so a stage can never be
 *    a status: a dead runner would strand the session in a state nothing can
 *    move out of.
 */
export enum BuilderSessionStatus {
  /** PRD interview in progress. */
  INTERVIEWING = 'INTERVIEWING',
  /** Interview converged; the PRD is ready to build from. */
  PRD_READY = 'PRD_READY',
  /** A build run is dispatched or running. */
  BUILDING = 'BUILDING',
  /** The agent paused mid-build and is waiting on an admin answer. */
  WAITING_FOR_INPUT = 'WAITING_FOR_INPUT',
  /** PRs opened (or the build finished with nothing to open). */
  COMPLETED = 'COMPLETED',
  /** The build gave up. Retryable — a retry starts a new run on the same branches. */
  FAILED = 'FAILED',
  /** A human stopped it. Deliberately distinct from FAILED. */
  CANCELLED = 'CANCELLED',
}

/** Non-terminal statuses — the set a cancel is valid from. */
export const BUILDER_ACTIVE_STATUSES: BuilderSessionStatus[] = [
  BuilderSessionStatus.INTERVIEWING,
  BuilderSessionStatus.PRD_READY,
  BuilderSessionStatus.BUILDING,
  BuilderSessionStatus.WAITING_FOR_INPUT,
];

/**
 * Statuses in which the PRD is frozen: a build run is reading it as its
 * source of truth, so an admin edit would silently diverge from what the
 * agent is implementing.
 */
export const BUILDER_PRD_FROZEN_STATUSES: BuilderSessionStatus[] = [
  BuilderSessionStatus.BUILDING,
  BuilderSessionStatus.WAITING_FOR_INPUT,
];

/**
 * Progress within BUILDING. Phase-boundary stages (PLANNING, CODING, GATE,
 * VERIFYING, REMEDIATING, FINALISING) are posted by run-engine.sh itself at
 * each phase transition, so the phase rail is machine-truthful; the finer
 * stages inside a phase (TESTING, E2E_VERIFY, OPENING_PRS, REPORTING) are
 * still agent-asserted.
 */
export enum BuilderStage {
  SETUP = 'SETUP',
  PLANNING = 'PLANNING',
  CODING = 'CODING',
  TESTING = 'TESTING',
  /** The machine test gate: every touched repo's test/lint/typecheck. */
  GATE = 'GATE',
  VERIFYING = 'VERIFYING',
  /** A coder re-invocation fixing gate failures or verifier objections. */
  REMEDIATING = 'REMEDIATING',
  /** E2E, commit, push, PRs, report — only reached on a green verify. */
  FINALISING = 'FINALISING',
  E2E_VERIFY = 'E2E_VERIFY',
  OPENING_PRS = 'OPENING_PRS',
  REPORTING = 'REPORTING',
  DONE = 'DONE',
}

export enum BuilderMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

/**
 * A single dispatched coding run. `WAITING_FOR_INPUT` is terminal *for the
 * run* — the runner has exited and the answer spawns a fresh `resume` run —
 * which is why it sits alongside the other end states rather than before them.
 */
export enum BuilderRunStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  TIMED_OUT = 'TIMED_OUT',
  WAITING_FOR_INPUT = 'WAITING_FOR_INPUT',
}

/** Run statuses that are still in flight — the set reconcile watches. */
export const BUILDER_RUN_ACTIVE_STATUSES: BuilderRunStatus[] = [
  BuilderRunStatus.QUEUED,
  BuilderRunStatus.RUNNING,
];

export enum BuilderRunMode {
  /** First run of a session: branch from master and start from the PRD. */
  BUILD = 'build',
  /** Continue on the branches a paused run left behind. */
  RESUME = 'resume',
  /**
   * Act on what happened to an already-open pull request: red CI, or a human's
   * review comments. Skips the planner and the reviewer — CI and a human
   * reviewer are already the second pair of eyes — but still runs the gate.
   */
  FIX = 'fix',
}

/** What arrived on a pull request after Builder opened it. */
export enum BuilderPrFeedbackKind {
  CI_FAILURE = 'ci_failure',
  /** An inline comment on a line of the diff. */
  REVIEW_COMMENT = 'review_comment',
  /** A review verdict — approved-with-comments, or changes requested. */
  REVIEW = 'review',
}

export enum BuilderPrFeedbackStatus {
  PENDING = 'pending',
  /** A fix run has it. */
  IN_FIX = 'in_fix',
  ADDRESSED = 'addressed',
  /** Builder disagreed, in writing, on the PR. */
  DISMISSED = 'dismissed',
  /** The PR closed underneath it — nothing left to act on. */
  STALE = 'stale',
  /**
   * Recorded, deliberately never actionable — and terminal from birth, unlike
   * every status above it.
   *
   * A CI failure on a head commit somebody else pushed. It is true, it belongs
   * in the timeline and the outcome flywheel wants it, but it is not Builder's
   * to fix: the person who pushed is mid-work on that branch, and a commit
   * arriving underneath them is how an agent turns into the reason nobody
   * reviews its pull requests. `countPending` counts PENDING alone, so this
   * status is the whole of the mechanism — a row written OBSERVED can never
   * drag itself into a fix run that some later review comment triggers.
   */
  OBSERVED = 'observed',
}

/**
 * Event types on the append-only build log.
 *
 * Two channels feed this. The *transcript* types (`text`, `tool_call`,
 * `tool_result`, `file_edit`) are normalised from the engine's own output by
 * the forwarder. The *semantic* types are asserted by the agent itself
 * through curl helpers, and are what the phase rail, todo list and pause
 * logic key off — so they stay meaningful whichever engine produced them.
 */
export enum BuilderEventType {
  TEXT = 'text',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  FILE_EDIT = 'file_edit',
  TODO = 'todo',
  TEST_OUTPUT = 'test_output',
  STAGE_CHANGE = 'stage_change',
  PLAN = 'plan',
  VERIFICATION = 'verification',
  /**
   * A machine-run test-gate result, posted by run-test-gate.sh rather than
   * asserted by the agent — the UI renders it as verified, not self-reported,
   * and /complete refuses a `done` for a run that never passed one.
   */
  GATE_RESULT = 'gate_result',
  /** Per-phase cost increment (plan/code/verify/finalise invocations). */
  PHASE_COST = 'phase_cost',
  /**
   * A run sitting at a phase boundary because the session's spend ceiling is
   * gone, waiting for it to be raised. `payload.state` is `held` when the wait
   * starts, `raised` when a new ceiling let it carry on, and `expired` when
   * nobody answered in time and the run stopped.
   *
   * A distinct type rather than an `error`: the run is alive and its work is
   * intact, and the feed has to say so — an error here reads as "that hour is
   * gone", which is exactly what the hold exists to prevent.
   */
  BUDGET_HOLD = 'budget_hold',
  QUESTION = 'question',
  E2E_EVIDENCE = 'e2e_evidence',
  E2E_SKIPPED = 'e2e_skipped',
  PR_OPENED = 'pr_opened',
  REPORT = 'report',
  COST = 'cost',
  ERROR = 'error',
  DONE = 'done',
}

export enum BuilderQuestionStatus {
  PENDING = 'pending',
  ANSWERED = 'answered',
  /** The run was cancelled or restarted before this was answered. */
  SUPERSEDED = 'superseded',
}

export enum BuilderReportType {
  /** Written by the agent at the end of a run. */
  RUN_REPORT = 'run_report',
  /** Composed by ally-be across a session's runs. */
  SESSION_REPORT = 'session_report',
  /** The agent's own "what would I do differently" — feeds builder_lessons. */
  RETROSPECTIVE = 'retrospective',
}

export enum BuilderNotificationKind {
  QUESTION_PENDING = 'question_pending',
  BUILD_COMPLETED = 'build_completed',
  BUILD_FAILED = 'build_failed',
  PRS_OPENED = 'prs_opened',
  BUDGET_REACHED = 'budget_reached',
  /** Builder is pushing to a PR a human may be reviewing right now. */
  FIX_RUN_STARTED = 'fix_run_started',
}

/**
 * A milestone's life. Mirrors the session states it can be in rather than
 * inventing new names, so a reader does not have to learn two vocabularies for
 * the same three things.
 */
export enum BuilderMilestoneStatus {
  PENDING = 'PENDING',
  BUILDING = 'BUILDING',
  WAITING_FOR_INPUT = 'WAITING_FOR_INPUT',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  /** A person decided this slice was not needed after all. */
  SKIPPED = 'SKIPPED',
}

/** Who wrote a PRD version — the agent's patches or the admin's own edit. */
export enum BuilderPrdVersionAuthor {
  AGENT = 'agent',
  ADMIN = 'admin',
}

/**
 * Categories for cross-session memory. The interviewer and the build prompt
 * both receive recent lessons, which is how build N+1 stops rediscovering
 * what build N learned the hard way.
 */
/**
 * Where a lesson is in its life.
 *
 * The flat table this replaces had no such notion: every retrospective bullet
 * went straight into the set fed to every future prompt, so the same trap
 * learned five times was five rows competing for the same context budget. A
 * candidate is raw harvest; the curator promotes, merges or retires it.
 */
export enum BuilderLessonStatus {
  /** Freshly harvested, not yet curated. Not fed to prompts. */
  CANDIDATE = 'candidate',
  /** In the curated set. This is what runs actually read. */
  ACTIVE = 'active',
  /** Folded into another lesson; kept as a tombstone for provenance. */
  MERGED = 'merged',
  /** Stale, contradicted, or subsumed. */
  RETIRED = 'retired',
}

/**
 * How a build turned out, once the humans have had their say.
 *
 * `closed_unmerged` is the most informative value here and the one the old
 * schema could not express at all: a rejected pull request and a merged one
 * looked identical, so nothing downstream could tell good work from bad.
 */
export enum BuilderExemplarOutcome {
  /** PRs are open; nobody has decided yet. */
  OPEN = 'open',
  MERGED = 'merged',
  /** Some repos merged, some did not. */
  PARTIALLY_MERGED = 'partially_merged',
  /** Closed without merging — the work was rejected. */
  CLOSED_UNMERGED = 'closed_unmerged',
  /** Never got as far as a pull request. */
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * Why a build needed more work than it should have.
 *
 * Tagging matters more than the individual tags: without a shared vocabulary,
 * "it went badly" is a story per build and a trend across none of them. These
 * are what the scoreboard groups by and what the curator reads to decide which
 * lessons are actually earning their place.
 */
export enum BuilderFailureTag {
  TEST_FAILURE = 'test_failure',
  TYPE_ERROR = 'type_error',
  LINT = 'lint',
  MIGRATION_CONFLICT = 'migration_conflict',
  /** CI broke for reasons that were not about the change. */
  CI_INFRA = 'ci_infra',
  BUILD_TIMEOUT = 'build_timeout',
  BUDGET_EXCEEDED = 'budget_exceeded',
  RUNNER_LOST = 'runner_lost',
  /** A reviewer said the code was wrong. */
  REVIEW_CORRECTNESS = 'review_correctness',
  /** A reviewer said it did more than was asked. */
  REVIEW_SCOPE_CREEP = 'review_scope_creep',
  REVIEW_STYLE = 'review_style',
  REVIEW_MISSING_TESTS = 'review_missing_tests',
  /** Nobody merged it and nobody said why. */
  CLOSED_ABANDONED = 'closed_abandoned',
  OTHER = 'other',
}

export enum BuilderLessonCategory {
  /** A trap that cost time — a build-order surprise, a silent failure mode. */
  GOTCHA = 'gotcha',
  /** A house pattern worth following next time. */
  CONVENTION = 'convention',
  /** How long something actually took versus the plan. */
  ESTIMATE = 'estimate',
  /** Something about how the Builder itself should work. */
  PROCESS = 'process',
}
