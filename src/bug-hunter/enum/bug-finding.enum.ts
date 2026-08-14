/**
 * Where a finding came from. `character varying` with a CHECK constraint, per
 * repo convention (see AnalyticsSuggestionStatus) — not a Postgres enum.
 *
 * The first four are Bug Hunter's own finders (see `.claude/workflows/bug-hunt.mjs`).
 * `REPORTED_BUG` additionally exists from the moment a human files a roadmap
 * item of type `bug` — see RoadmapOpportunityService.create — independently of
 * whether any hunt run has looked at it yet. `ANALYTICS_SUGGESTION` exists only
 * on rows backfilled from the old Analytics → Suggestions bug queue (migration
 * 1898000000000); no code path writes it going forward.
 */
export enum BugFindingSource {
  TEST_FAILURE = 'test_failure',
  LINT_ERROR = 'lint_error',
  CODE_REVIEW = 'code_review',
  PRODUCTION_LOG = 'production_log',
  REPORTED_BUG = 'reported_bug',
  ANALYTICS_SUGGESTION = 'analytics_suggestion',
}

export enum BugFindingSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * Where a finding sits in the find → (approve) → fix → land pipeline.
 *
 * Transitions:
 *   NEW → PENDING_APPROVAL   (Manual mode only: verify confirmed it, discovery
 *                              itself never gates on mode)
 *   NEW → FIXING              (AI mode: verify-confirmed findings skip approval)
 *   NEW → DISMISSED            (verify refuted it)
 *   PENDING_APPROVAL → APPROVED | REJECTED   (admin decision)
 *   APPROVED → FIXING          (a later run's Fix phase picks it up)
 *   FIXING → NEEDS_INPUT       (fix agent hit a genuine open product question)
 *   NEEDS_INPUT → FIXING       (an admin answered; the pipeline resumed)
 *   FIXING → PR_OPENED | MERGED | DISMISSED | FAILED
 *
 * NEW is also the resting state for a human-reported bug from the moment it's
 * filed until a hunt run triages it — see the source doc above.
 */
export enum BugFindingStatus {
  NEW = 'new',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  FIXING = 'fixing',
  NEEDS_INPUT = 'needs_input',
  PR_OPENED = 'pr_opened',
  MERGED = 'merged',
  DISMISSED = 'dismissed',
  REJECTED = 'rejected',
  FAILED = 'failed',
}

/** Statuses a client may filter the table by, plus the "show everything" option. */
export const BUG_FINDING_STATUS_FILTERS = [
  ...Object.values(BugFindingStatus),
  'all',
] as const;

export type BugFindingStatusFilter =
  (typeof BUG_FINDING_STATUS_FILTERS)[number];

/**
 * The kill switch's three positions, replacing the old plain boolean.
 *
 *   OFF    — every trigger refuses to run, exactly like `enabled=false` before.
 *   MANUAL — discovery (find + verify) still runs on every trigger; only the
 *            fix/PR/merge stage waits for an admin to approve each finding.
 *   AI     — today's original behaviour: verify-confirmed findings go straight
 *            to the fix stage with no approval gate.
 *
 * There is no separate "pause discovery" state in Manual mode — see
 * BugFindingStatus's doc. That was an explicit product decision, not an
 * oversight: a comprehensive bug table is only useful if it keeps finding
 * bugs regardless of who's allowed to fix them.
 */
export enum BugHunterMode {
  OFF = 'off',
  MANUAL = 'manual',
  AI = 'ai',
}
