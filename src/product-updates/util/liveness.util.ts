/**
 * When a merged change reached users — decided from release history, never by
 * a model.
 *
 * Master is not production. Every Ally deployable ships on its own release
 * workflow (see `src/release/constants/release-targets.constants.ts`), and a
 * feature is only live once every deployable it touched has shipped: the
 * admin toggle without the ally-be migration behind it is a switch that does
 * nothing. So a change's live time is the latest of its deployables' first
 * successful release after the merge, and an update's is the latest of its
 * changes'.
 *
 * "First successful release that STARTED after the merge" is the rule Bug
 * Hunter and Builder already use (`findSuccessfulRunSince`). It is sound
 * because every release workflow builds its branch head at the moment it
 * starts; a run that began before the merge cannot contain it.
 */

export type Deployable =
  | 'ally-be'
  | 'ally-ai'
  | 'ally-ai-learn'
  | 'ally-web:admin'
  | 'ally-web:helpline'
  | 'ally-mobile';

/**
 * Deployables merged sources may still carry from before a target was retired.
 * `ally-web:web` was the marketing site, which no longer lives in ally-web and
 * has no release workflow to observe — waiting on it meant waiting forever.
 */
const RETIRED_DEPLOYABLES: ReadonlySet<string> = new Set(['ally-web:web']);

/** The deployables a stored source must still wait on: retired targets wait on nothing. */
export function trackedDeployables(
  deployables: readonly string[],
): Deployable[] {
  return deployables.filter(
    (deployable) => !RETIRED_DEPLOYABLES.has(deployable),
  ) as Deployable[];
}

/**
 * The release workflows whose history decides liveness. ally-mobile is two:
 * a production build only uploads to the Play internal track, and a separate
 * promotion puts it in front of users. iOS follows through App Store review,
 * which is asynchronous and not visible in Actions, so Android's promotion is
 * the signal: it is the moment a mobile change can first be in a user's hands.
 */
export const RELEASE_HISTORY_KEYS = [
  'ally-be',
  'ally-ai',
  'ally-ai-learn',
  'ally-web:admin',
  'ally-web:helpline',
  'ally-mobile:build',
  'ally-mobile:promote',
] as const;
export type ReleaseHistoryKey = (typeof RELEASE_HISTORY_KEYS)[number];

export interface ReleaseRun {
  startedAt: Date;
  finishedAt: Date;
}

/** Successful runs per workflow. Order does not matter; callers need not sort. */
export type ReleaseHistory = Partial<Record<ReleaseHistoryKey, ReleaseRun[]>>;

const WEB_APPS: [RegExp, Deployable][] = [
  [/^apps\/ally-admin-dashboard\//, 'ally-web:admin'],
  [/^apps\/ally-helpline-dashboard\//, 'ally-web:helpline'],
];

/** ally-changelog's `changed_apps` names, for when a file list is unavailable. */
const WEB_APP_NAMES: Record<string, Deployable> = {
  'ally-admin-dashboard': 'ally-web:admin',
  'ally-helpline-dashboard': 'ally-web:helpline',
};

/**
 * Which deployables must release before this change is live.
 *
 * ally-web is a monorepo of separately-tagged apps, so its answer comes
 * from the file paths. Shared `libs/` code ships inside every app that imports
 * it; the two product apps (admin and the helpline web app) are what users see,
 * so a libs change waits on both. An ally-web change touching no app at all (root config,
 * tooling) waits on nothing.
 *
 * `infra` and anything unknown wait on nothing: nothing a user sees ships from
 * them on a release this module can observe.
 */
export function deployablesFor(
  repo: string,
  files: readonly string[],
  apps: readonly string[] = [],
): Deployable[] {
  switch (repo) {
    case 'ally-be':
    case 'ally-ai':
    case 'ally-ai-learn':
    case 'ally-mobile':
      return [repo];
    case 'ally-web': {
      const found = new Set<Deployable>();
      for (const file of files) {
        for (const [pattern, deployable] of WEB_APPS) {
          if (pattern.test(file)) found.add(deployable);
        }
        if (file.startsWith('libs/')) {
          found.add('ally-web:admin');
          found.add('ally-web:helpline');
        }
      }
      if (found.size === 0 && files.length === 0) {
        for (const app of apps) {
          const deployable = WEB_APP_NAMES[app];
          if (deployable) found.add(deployable);
        }
      }
      return [...found];
    }
    default:
      return [];
  }
}

function firstRunStartingAfter(
  runs: readonly ReleaseRun[] | undefined,
  after: Date,
): ReleaseRun | null {
  let best: ReleaseRun | null = null;
  for (const run of runs ?? []) {
    if (run.startedAt.getTime() < after.getTime()) continue;
    if (!best || run.startedAt.getTime() < best.startedAt.getTime()) best = run;
  }
  return best;
}

/** When one deployable first shipped a change merged at `mergedAt`, or null if it has not. */
export function deployableLiveAt(
  deployable: Deployable,
  mergedAt: Date,
  history: ReleaseHistory,
): Date | null {
  if (deployable === 'ally-mobile') {
    const build = firstRunStartingAfter(history['ally-mobile:build'], mergedAt);
    if (!build) return null;
    const promote = firstRunStartingAfter(
      history['ally-mobile:promote'],
      build.finishedAt,
    );
    return promote ? promote.finishedAt : null;
  }
  return (
    firstRunStartingAfter(history[deployable], mergedAt)?.finishedAt ?? null
  );
}

/**
 * When a change was live everywhere it had to be: the latest of its
 * deployables' release times. A change with nothing to wait for is live the
 * moment it merged. Null while any deployable has not shipped it.
 */
export function changeLiveAt(
  deployables: readonly Deployable[],
  mergedAt: Date,
  history: ReleaseHistory,
): Date | null {
  let latest = mergedAt;
  for (const deployable of trackedDeployables(deployables)) {
    const liveAt = deployableLiveAt(deployable, mergedAt, history);
    if (!liveAt) return null;
    if (liveAt.getTime() > latest.getTime()) latest = liveAt;
  }
  return latest;
}

/** Which of a change's deployables are still waiting, for "merged — waiting on the admin release". */
export function pendingDeployables(
  deployables: readonly Deployable[],
  mergedAt: Date,
  history: ReleaseHistory,
): Deployable[] {
  return trackedDeployables(deployables).filter(
    (deployable) => !deployableLiveAt(deployable, mergedAt, history),
  );
}
