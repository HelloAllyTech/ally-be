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
 * The repo-wide sweep workflow, dispatched by the admin tab's "Start a sweep"
 * button and by each repo's own nightly cron. Same filename in every repo, and
 * as thin as `bug-fix-session.yml` for the same reason: it fetches its protocol
 * from `GET pipeline/sweep-prompt` rather than carrying a copy.
 */
export const BUG_HUNT_SWEEP_WORKFLOW_FILE = 'bug-hunt-sweep.yml';

/** Repos a fix session may be dispatched for — i.e. those carrying `bug-fix-session.yml`. */
export const BUG_FIX_SESSION_REPOS = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
] as const;

export type BugFixSessionRepo = (typeof BUG_FIX_SESSION_REPOS)[number];

/**
 * One deployable unit: which workflow releases it and what its version tags
 * look like.
 *
 * `ally-web` is a monorepo with three independently-tagged apps, which is why
 * this is keyed by deployable rather than by repo — see
 * `resolveReleaseTarget`, and note that a fix touching `libs/` is deliberately
 * NOT auto-resolvable, since it ships in all three.
 *
 * `ally-mobile` is absent: it releases through App Store / Play Store build
 * workflows, not a dispatchable production-release pipeline, so a fix there
 * can never be released from this button.
 */
export interface ReleaseTarget {
  repo: string;
  /** Workflow filename in that repo's `.github/workflows/`. */
  workflow: string;
  /** Tag prefix its `version_tag` input validates against, e.g. `v` or `admin-v`. */
  tagPrefix: string;
  /** Shown to the admin in the release confirmation. */
  label: string;
}

export const RELEASE_TARGETS: Record<string, ReleaseTarget> = {
  'ally-be': {
    repo: 'ally-be',
    workflow: 'production-release.yaml',
    tagPrefix: 'v',
    label: 'Ally backend (ECS)',
  },
  'ally-ai': {
    repo: 'ally-ai',
    workflow: 'production-release.yaml',
    tagPrefix: 'v',
    label: 'Ally AI (ECS)',
  },
  'ally-ai-learn': {
    repo: 'ally-ai-learn',
    workflow: 'production-release.yaml',
    tagPrefix: 'v',
    label: 'Ally AI Learn (ECS)',
  },
  'ally-web:admin': {
    repo: 'ally-web',
    workflow: 'production-release-admin-dashboard.yaml',
    tagPrefix: 'admin-v',
    label: 'Admin dashboard (CloudFront)',
  },
  'ally-web:helpline': {
    repo: 'ally-web',
    workflow: 'production-release-helpline-dashboard.yaml',
    tagPrefix: 'helpline-v',
    label: 'Helpline dashboard (CloudFront)',
  },
  'ally-web:web': {
    repo: 'ally-web',
    workflow: 'production-release-web.yaml',
    tagPrefix: 'web-v',
    label: 'Marketing site',
  },
};

/**
 * Which deployable a finding belongs to.
 *
 * Single-app repos answer from `repo` alone. `ally-web` needs the file path,
 * because its three apps tag and deploy separately — and when the path doesn't
 * name exactly one app (a `libs/ui-shared` change ships in all three, a null
 * file names none), this returns null rather than picking one. The caller
 * turns that into a refusal telling the admin to release manually: guessing
 * which of three production frontends to deploy is exactly the ambiguous case
 * that should reach a human.
 */
export function resolveReleaseTarget(
  repo: string | null | undefined,
  file: string | null | undefined,
): ReleaseTarget | null {
  if (!repo) return null;
  if (repo !== 'ally-web') return RELEASE_TARGETS[repo] ?? null;

  if (!file) return null;
  if (file.includes('apps/ally-admin-dashboard'))
    return RELEASE_TARGETS['ally-web:admin'];
  if (file.includes('apps/ally-helpline-dashboard'))
    return RELEASE_TARGETS['ally-web:helpline'];
  if (file.includes('apps/ally-web')) return RELEASE_TARGETS['ally-web:web'];
  return null;
}

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
