/**
 * What production deployables exist, and which one a change belongs to.
 *
 * Platform knowledge, not any one feature's: Bug Hunter released merged fixes
 * from here first, and Builder now releases merged pull requests from the same
 * table. Keeping one copy is the point — a new deployable, a renamed workflow
 * or a changed tag prefix has exactly one place to be wrong.
 */
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
 * workflows, not a dispatchable production-release pipeline, so a merged fix
 * there can never be released from this button — regardless, it never merges
 * on its own anyway (see `BUG_FIX_SESSION_REPOS` above), so a human handles
 * both the merge and the eventual app-store release manually.
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
 * Every deployable a set of changed files touches.
 *
 * `resolveReleaseTarget` answers for one file, which is all a Bug Hunter
 * finding has. A pull request is a set, and the set changes the question in two
 * ways that matter:
 *
 *  - it can span deployables. One ally-web pull request touching both the admin
 *    and helpline apps has to release both, or half of it is live.
 *  - it can touch shared code. A change under `libs/` ships inside all three
 *    frontends, so releasing only the apps whose paths happened to match would
 *    silently under-deploy it.
 *
 * So this reports what it matched *and* whether anything was left over.
 * `ambiguous` is not "an error" — it is "a person should decide", the same
 * answer `resolveReleaseTarget` gives by returning null, and an automatic
 * caller is expected to stop rather than release the subset it understood.
 */
export interface ReleaseTargetSet {
  targets: ReleaseTarget[];
  /** Changed files that belong to no single deployable (shared code, config, tooling). */
  unresolved: string[];
  /** True when something changed that this cannot confidently attribute. */
  ambiguous: boolean;
}

export function resolveReleaseTargets(
  repo: string | null | undefined,
  files: readonly string[],
): ReleaseTargetSet {
  const empty: ReleaseTargetSet = {
    targets: [],
    unresolved: [...files],
    ambiguous: true,
  };
  if (!repo) return empty;

  // Single-app repos answer from the repo alone, and every file in the pull
  // request ships together — there is nothing to attribute.
  if (repo !== 'ally-web') {
    const target = RELEASE_TARGETS[repo];
    return target
      ? { targets: [target], unresolved: [], ambiguous: false }
      : empty;
  }

  const matched = new Map<string, ReleaseTarget>();
  const unresolved: string[] = [];
  for (const file of files) {
    const target = resolveReleaseTarget(repo, file);
    if (target) matched.set(target.workflow, target);
    else unresolved.push(file);
  }

  return {
    targets: [...matched.values()],
    unresolved,
    // No targets at all is ambiguous for the obvious reason. Leftover files
    // alongside real matches is the subtler one: shared code changed, and it
    // ships in apps whose own files this pull request never touched.
    ambiguous: matched.size === 0 || unresolved.length > 0,
  };
}
