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

/** Agent-reported progress within BUILDING. */
export enum BuilderStage {
  SETUP = 'SETUP',
  PLANNING = 'PLANNING',
  CODING = 'CODING',
  TESTING = 'TESTING',
  VERIFYING = 'VERIFYING',
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
