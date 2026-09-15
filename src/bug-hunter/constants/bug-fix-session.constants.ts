/**
 * Everything the on-demand fix session and the release-to-production step
 * need to know about each repo's CI.
 *
 * This is a hand-maintained allowlist on purpose. Dispatching a workflow is a
 * write into another repo's CI and, for the release side, a live production
 * deploy — so a repo Bug Hunter has never been configured for should fail
 * loudly at the API boundary rather than have a workflow filename guessed for
 * it. Adding a repo here is the deliberate act of opting it in.
 */

/** The Claude Code fix-session workflow, dispatched by "Start fix session". Same filename in every repo. */
export const BUG_FIX_SESSION_WORKFLOW_FILE = 'bug-fix-session.yml';

/** Branch the fix-session workflow is dispatched against. All Ally repos ship from `master`. */
export const BUG_FIX_SESSION_DEFAULT_REF = 'master';

/**
 * `roadmap_opportunities.owner` written when a reported bug's linked finding
 * merges (see the shared `releaseLinkedRoadmapOpportunity` util). Must
 * already exist in `roadmap_opportunity_owners` — see the FK-by-name note on
 * `RoadmapOpportunity.owner` — which is why migration 1913000000000 seeds it.
 */
export const BUG_HUNTER_AGENT_ROADMAP_OWNER = 'Bug Hunter Agent';

/**
 * The repo-wide sweep workflow, dispatched by the admin tab's "Start a sweep"
 * button and by each repo's own nightly cron. Same filename in every repo, and
 * as thin as `bug-fix-session.yml` for the same reason: it fetches its protocol
 * from `GET pipeline/sweep-prompt` rather than carrying a copy.
 */
export const BUG_HUNT_SWEEP_WORKFLOW_FILE = 'bug-hunt-sweep.yml';

/**
 * The `timeout-minutes` every repo's `bug-hunt-sweep.yml` job carries, quoted
 * to the sweep agent as its real budget — same reasoning as
 * `BUG_FIX_SESSION_JOB_TIMEOUT_MINUTES` below, and double it, because a sweep
 * works through every finding it discovers rather than one.
 */
export const BUG_HUNT_SWEEP_JOB_TIMEOUT_MINUTES = 120;

/**
 * Repos a fix session may be dispatched for — i.e. those carrying
 * `bug-fix-session.yml`. `ally-mobile` is fixable (opens a PR) but never
 * auto-merges and never appears in `RELEASE_TARGETS` below — see
 * `buildFixSessionPrompt`'s merge-policy doc.
 */
export const BUG_FIX_SESSION_REPOS = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
  'ally-mobile',
] as const;

export type BugFixSessionRepo = (typeof BUG_FIX_SESSION_REPOS)[number];

/**
 * Deployables and how to pick one live in `src/release/constants` now: Builder
 * releases merged pull requests from the same table, and two copies of it would
 * mean two places for a renamed workflow or a changed tag prefix to be wrong.
 *
 * Re-exported rather than relocated-and-rewritten at every call site, so this
 * module's public surface is unchanged.
 */
export {
  RELEASE_TARGETS,
  resolveReleaseTarget,
  resolveReleaseTargets,
} from 'src/release/constants/release-targets.constants';
export type {
  ReleaseTarget,
  ReleaseTargetSet,
} from 'src/release/constants/release-targets.constants';

/**
 * How long a dispatched fix session may sit in QUEUED before the reconcile
 * task calls it lost.
 *
 * Generous: a GitHub Actions run can queue for minutes before a runner picks
 * it up, and the workflow itself only reports in once Claude Code has booted
 * and made its first call. Anything still QUEUED after this never started.
 */
export const BUG_FIX_SESSION_DISPATCH_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * How long a release may sit in RELEASING before the reconcile task stops
 * waiting. ally-be's production-release runs tests, a Docker build, a DB
 * migration task and an ECS deploy with `wait-for-service-stability` — the
 * slowest of the pipelines by a wide margin — so this is set well past its
 * normal duration rather than near it.
 */
export const BUG_RELEASE_TIMEOUT_MS = 90 * 60 * 1000;

/**
 * How long a fix session may sit in FIXING with no resolvable GitHub Actions
 * run before the reconcile task gives up waiting for one.
 *
 * Every repo's `bug-fix-session.yml` caps itself at `timeout-minutes: 60`, so
 * GitHub itself never lets a run outlive that — this is only the fallback for
 * when `sessionRunId` was never resolved at all (a `findRunSince` that kept
 * missing), set past the workflow's own cap rather than near it, the same
 * reasoning as `BUG_RELEASE_TIMEOUT_MS`.
 */
export const BUG_FIX_SESSION_RUN_TIMEOUT_MS = 75 * 60 * 1000;

/**
 * The `timeout-minutes` every repo's `bug-fix-session.yml` job carries, quoted
 * to the fix agent as its real budget.
 *
 * The agent needs to know this number. Not knowing it is what makes a long
 * command look like something to escape rather than something to wait for —
 * and a fix session that backgrounds its commit and ends its turn throws the
 * whole session away, because the runner dies with the process. Kept here
 * rather than inline in the prompt so the two places that state the cap are
 * one edit apart; `BUG_FIX_SESSION_RUN_TIMEOUT_MS` above is deliberately set
 * past it.
 */
export const BUG_FIX_SESSION_JOB_TIMEOUT_MINUTES = 60;
