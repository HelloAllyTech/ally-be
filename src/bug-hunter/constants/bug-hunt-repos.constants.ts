/**
 * The one definition of what Bug Hunter knows about each repo it works on.
 *
 * ## Why this file exists
 *
 * Until now the test/lint commands lived in TWO places: a `REPO_COMMANDS` map
 * in `.claude/workflows/bug-hunt.mjs` (five repos) and a second copy in
 * `bug-fix-prompt.ts` (four repos), whose own comment conceded the duplication
 * and asked whoever changed one to remember the other. The two had already
 * drifted by an entry. That is precisely the "if you find a rule written twice
 * anywhere in this platform, that's a bug worth fixing" case from
 * ally-be/CLAUDE.md — and the same reasoning that put the fix protocol in
 * ally-be rather than in four workflow files applies to the commands it runs.
 *
 * So: ally-be owns this map, the fix and sweep prompts import it, and
 * `bug-hunt.mjs` fetches it over `GET pipeline/repo-commands` instead of
 * carrying its own copy. One definition, three readers.
 */

/** Whether Bug Hunter can only look at a repo, or also open and merge a fix in it. */
export interface BugHuntRepoConfig {
  /** Command that must exit 0 for a fix to be considered green. */
  test: string;
  /** Lint gate. A lint error is itself a valid (low-severity, proven) finding. */
  lint: string;
  /**
   * False when the repo can be swept for bugs but no fix can be dispatched to
   * it — it carries no `bug-fix-session.yml`. Sweeping a non-fixable repo is
   * still worth doing: the finding gets recorded for a human even though the
   * agent cannot act on it.
   */
  fixable: boolean;
}

export const BUG_HUNT_REPOS: Record<string, BugHuntRepoConfig> = {
  'ally-be': { test: 'npm test', lint: 'npm run lint', fixable: true },
  'ally-web': { test: 'npm test', lint: 'npm run lint', fixable: true },
  'ally-ai': {
    test: 'poetry run pytest tests/ -v',
    lint: 'poetry run flake8',
    fixable: true,
  },
  'ally-ai-learn': {
    test: 'poetry run python -m pytest tests/ -v',
    lint: 'poetry run flake8',
    fixable: true,
  },
  // Fixable, but never auto-merged — see buildFixSessionPrompt's merge-policy
  // doc: this pipeline only runs Jest, which cannot verify the native /
  // on-device behaviour a mobile fix actually ships. A fix session opens a PR
  // for a human to merge; it does not land on its own.
  'ally-mobile': { test: 'npm test', lint: 'npm run lint', fixable: true },
};

/** Every repo a sweep may run against. */
export const BUG_HUNT_SWEEPABLE_REPOS = Object.keys(BUG_HUNT_REPOS);

/**
 * Commands for one repo, or null if Bug Hunter has never been configured for
 * it. Callers that need a prompt must treat null as a hard error rather than
 * emitting a protocol with no way to verify anything — see buildFixPrompt.
 */
export function repoCommands(repo: string): BugHuntRepoConfig | null {
  return BUG_HUNT_REPOS[repo] ?? null;
}
