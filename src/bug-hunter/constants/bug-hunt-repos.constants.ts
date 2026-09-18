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
   * A repo's real PR-gate CI can enforce more than `test`+`lint` alone. A
   * fix that passes both locally still opens a PR that fails the moment
   * someone tries to merge it if the real gate checks something neither
   * command does — found from a real, recurring pattern: ally-be's and
   * ally-web's `lint` is bare ESLint, but their `.github/workflows/test.yml`
   * also runs a separate, blocking TypeScript compile
   * (`tsc --noEmit`) that ESLint's own rules never catch. Optional because
   * it's a genuine gap only for these two — ally-ai/ally-ai-learn's flake8
   * and ally-mobile's eslint already match their CI exactly (confirmed
   * directly against each repo's `test.yml`), and ally-mobile's own
   * `tsc --noEmit` exists only in a local Husky pre-commit hook, never in
   * CI, so there is nothing here for it to close.
   *
   * Two other real PR-gate workflows (`docs.yml`'s docs-guard, and
   * `secret-scan.yml`'s gitleaks on ally-ai) are NOT modeled as a command
   * here — neither is a "run this and check the exit code" gate the fix
   * protocol could satisfy the same way; they need their own, different
   * handling as a later pass.
   */
  typecheck?: string;
  /**
   * False when the repo can be swept for bugs but no fix can be dispatched to
   * it — it carries no `bug-fix-session.yml`. Sweeping a non-fixable repo is
   * still worth doing: the finding gets recorded for a human even though the
   * agent cannot act on it.
   */
  fixable: boolean;
  /**
   * Whether the bug-hunter bot account can actually land its own PR here.
   *
   * ## Why this has to be declared rather than discovered
   *
   * The fix protocol told the agent to merge with `gh pr merge --admin` on
   * every repo. On three of them that command cannot succeed: `master`
   * requires an approving review and the bot holds `write`, not `admin`, so
   * `--admin` has nothing to bypass with. Both fix sessions inspected on
   * 2026-09-02 ended the same way — a green PR, thirty-odd minutes spent, and
   * a final message explaining that a human with admin rights would have to
   * merge it. The work was fine; the instruction was a lie the agent
   * discovered at the last step.
   *
   * Asking GitHub at prompt-build time was the alternative and is worse: it
   * spends an API call on every dispatch to answer a question that changes
   * about once a quarter, and a rate-limited or flaky answer would flip the
   * protocol's most consequential instruction. Declaring it keeps the failure
   * mode legible — this flag being wrong is a one-line fix, and the workflow
   * still refuses to merge a red PR either way.
   *
   * Where this is false the agent stops at an open, green PR and Bug Hunter
   * surfaces it as an explicit "waiting for your merge" item in the tab, which
   * is a one-click merge rather than a trip to GitHub.
   *
   * KEEP IN STEP WITH REALITY: if branch protection changes, or the bot is
   * granted admin, this is the line to change.
   */
  canBotMerge: boolean;
}

export const BUG_HUNT_REPOS: Record<string, BugHuntRepoConfig> = {
  // The three protected repos: `master` requires one approving review and the
  // bot holds `write`, so `gh pr merge --admin` cannot land anything here. The
  // fix agent leaves a green PR and the admin tab offers the merge — see
  // `canBotMerge`.
  'ally-be': {
    test: 'npm test',
    lint: 'npm run lint',
    typecheck: 'npx tsc --noEmit -p tsconfig.json',
    fixable: true,
    canBotMerge: false,
  },
  'ally-web': {
    test: 'npm test',
    lint: 'npm run lint',
    // Three separate project configs — CI's own "typecheck" job runs each
    // as its own step; chained with && here so one command still means "all
    // green or stop", matching how the fix protocol already treats
    // test/lint. This is CI's real gate, not `lint`: that job is
    // continue-on-error there (see test.yml's own comment), so typecheck is
    // actually the only one of the two that blocks a merge.
    typecheck:
      'npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json && npx tsc --noEmit -p apps/ally-helpline-dashboard/tsconfig.app.json && npx tsc --noEmit -p libs/ui-shared/tsconfig.lib.json',
    fixable: true,
    canBotMerge: false,
  },
  'ally-ai': {
    test: 'poetry run pytest tests/ -v',
    lint: 'poetry run flake8',
    fixable: true,
    canBotMerge: false,
  },
  // Unprotected `master`, so the bot genuinely can and does merge its own
  // work here. That makes this the repo where the workflow's own
  // wait-for-checks step is the only gate between an agent's diff and master
  // — see the fix prompt's merge step, which watches the PR's checks rather
  // than bypassing them.
  'ally-ai-learn': {
    test: 'poetry run python -m pytest tests/ -v',
    lint: 'poetry run flake8',
    fixable: true,
    canBotMerge: true,
  },
  // Fixable, but never auto-merged — see buildFixSessionPrompt's merge-policy
  // doc: this pipeline only runs Jest, which cannot verify the native /
  // on-device behaviour a mobile fix actually ships. A fix session opens a PR
  // for a human to merge; it does not land on its own. `canBotMerge` is false
  // for that product reason rather than a permissions one, and the two
  // deliberately produce the same instruction.
  'ally-mobile': {
    test: 'npm test',
    lint: 'npm run lint',
    fixable: true,
    canBotMerge: false,
  },
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

/**
 * `test`, `lint`, and `typecheck` (where configured) as one English list of
 * quoted commands — "X" and "Y", or "X", "Y", and "Z" once typecheck exists
 * for a repo. One place to build this rather than three copies drifting
 * across the fix prompt's and sweep prompt's own verification steps.
 */
export function verifyCommandsList(commands: BugHuntRepoConfig): string {
  const quoted = [commands.test, commands.lint, commands.typecheck]
    .filter((cmd): cmd is string => Boolean(cmd))
    .map((cmd) => `"${cmd}"`);
  if (quoted.length <= 2) return quoted.join(' and ');
  return `${quoted.slice(0, -1).join(', ')}, and ${quoted[quoted.length - 1]}`;
}
