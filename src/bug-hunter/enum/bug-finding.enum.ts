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
 *
 * `UX_SIGNAL` is written by the UX Signals scan (src/ux-signals), which reads
 * PostHog telemetry rather than the codebase. Those findings carry no `file`:
 * their stable coordinate is a route/element, passed as `symbol` so they dedupe
 * precisely instead of falling back to the description fingerprint.
 */
export enum BugFindingSource {
  TEST_FAILURE = 'test_failure',
  LINT_ERROR = 'lint_error',
  CODE_REVIEW = 'code_review',
  PRODUCTION_LOG = 'production_log',
  REPORTED_BUG = 'reported_bug',
  ANALYTICS_SUGGESTION = 'analytics_suggestion',
  UX_SIGNAL = 'ux_signal',
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
 * Plus the on-demand fix-session path (BugFixSessionService), which an admin
 * drives one bug at a time from the drawer:
 *
 *   NEW | PENDING_APPROVAL | APPROVED | PR_OPENED | FAILED | NEEDS_INPUT
 *      → QUEUED              (admin pressed "Start fix session"; GitHub
 *                              Actions dispatch accepted, workflow not yet in)
 *   QUEUED → FIXING           (the dispatched workflow reported in)
 *   QUEUED | FIXING → CANCELLED   (admin pressed "Stop fix session" — see
 *                                   BugFixSessionService.cancelFixSession)
 *   MERGED → RELEASING        (admin pressed "Release to production")
 *   RELEASING → RELEASED | RELEASE_FAILED   (reconciled from the GitHub run)
 *
 * RELEASE_FAILED is deliberately distinct from FAILED: FAILED means the fix
 * agent gave up and nothing landed, whereas RELEASE_FAILED means the fix IS
 * merged to master and only the deploy went red — a completely different thing
 * for an admin to act on, and re-releasable once CI is green.
 *
 * CANCELLED is likewise deliberately distinct from FAILED: FAILED means the
 * agent itself gave up, CANCELLED means a human stopped it on purpose — the
 * manual kill switch for a session that is clearly stuck or looping, so it
 * stops burning tokens/compute for the rest of its 60-minute cap rather than
 * running to the timeout. Same retry story as FAILED — see
 * BUG_FINDING_FIX_SESSION_START_STATUSES.
 *
 * NEW is also the resting state for a human-reported bug from the moment it's
 * filed until a hunt run triages it — see the source doc above.
 */
export enum BugFindingStatus {
  NEW = 'new',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  QUEUED = 'queued',
  FIXING = 'fixing',
  NEEDS_INPUT = 'needs_input',
  /** A child step whose turn hasn't come yet — an earlier repo in the plan has to land first. */
  BLOCKED = 'blocked',
  /** A parent whose plan is being worked through, one repo at a time. Never a leaf's status. */
  COORDINATING = 'coordinating',
  PR_OPENED = 'pr_opened',
  MERGED = 'merged',
  RELEASING = 'releasing',
  RELEASED = 'released',
  RELEASE_FAILED = 'release_failed',
  DISMISSED = 'dismissed',
  REJECTED = 'rejected',
  FAILED = 'failed',
  /** An admin stopped a running fix session. Distinct from FAILED: a human decision, not the agent giving up — see BugFixSessionService.cancelFixSession. */
  CANCELLED = 'cancelled',
}

/**
 * A parent's status is derived from its children, never set directly by a fix
 * agent — see BugFixSessionService.syncParent. These are the only values a
 * coordinated parent ever holds.
 */
export const BUG_FINDING_PARENT_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.COORDINATING,
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASING,
  BugFindingStatus.RELEASED,
  BugFindingStatus.RELEASE_FAILED,
  BugFindingStatus.FAILED,
  BugFindingStatus.NEEDS_INPUT,
  // A parent takes this on when one of its steps is cancelled mid-plan — see
  // BugFixSessionService.haltPlan. A parent itself is never QUEUED/FIXING
  // (only a leaf step is), so it can only ever arrive here via a stuck child.
  BugFindingStatus.CANCELLED,
];

/**
 * Statuses an admin may start a fix session from.
 *
 * Deliberately broad — a NEW human-reported bug is the headline case (the
 * whole point of the button is that a human already knows this is a real bug
 * and doesn't want to wait for a nightly sweep to rediscover it), and FAILED /
 * PR_OPENED are here so a stalled attempt can be retried without a fresh
 * discovery pass. CANCELLED is here for the same reason as FAILED: a human
 * stopped a stuck session, but the bug still needs fixing. Excluded: MERGED
 * and everything downstream of it (already fixed — releasing is the next
 * step, not fixing), DISMISSED/REJECTED (a human or the verifier already said
 * no; re-opening should be a deliberate separate act), and
 * QUEUED/FIXING/RELEASING (a session is already in flight — see
 * BugFixSessionService.start's double-dispatch guard).
 */
export const BUG_FINDING_FIX_SESSION_START_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.NEW,
  BugFindingStatus.PENDING_APPROVAL,
  BugFindingStatus.APPROVED,
  BugFindingStatus.NEEDS_INPUT,
  BugFindingStatus.PR_OPENED,
  BugFindingStatus.FAILED,
  BugFindingStatus.CANCELLED,
];

/**
 * Statuses an admin may rewrite the description from.
 *
 * The same list as BUG_FINDING_FIX_SESSION_START_STATUSES, and deliberately
 * so: the point of editing is to improve the brief a fix session will read, so
 * the edit belongs exactly where the "Put me on it" button is offered and
 * nowhere else. Derived from that list rather than re-typed, so the two can
 * never drift apart.
 *
 * What this excludes is the interesting half. QUEUED and FIXING are out even
 * though a runner fetches the prompt fresh (see the pipeline controller's
 * `getFixPrompt`) and an edit made in that window would technically reach the
 * agent: whether it lands depends on a race with the runner starting, and a
 * field whose effect is "maybe" is worse than one that is plainly closed.
 * MERGED and everything past it are out because a fix already exists — the
 * description now documents what was fixed, and rewriting history there would
 * make the PR and the bug disagree.
 */
export const BUG_FINDING_DESCRIPTION_EDITABLE_STATUSES: BugFindingStatus[] =
  BUG_FINDING_FIX_SESSION_START_STATUSES;

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
