/**
 * Files a Bug Hunter fix may not land on its own (OPP-0759).
 *
 * Two kinds. The first is data a person has to count rather than skim:
 * migrations, locale files, seeds, snapshots, lockfiles, generated output.
 * The second is Bug Hunter's own machinery, which a fix session has no
 * business touching and has touched by accident: on 2026-10-09 PR 608 on
 * ally-be committed the workflow's rewrite of `.claude/agents/bug-escalation.md`
 * and a stray `pr-body.md` the brief had told it to write in /tmp.
 *
 * Used twice: the Verifier's verdict fails deterministically when the PR
 * touches any of these (`forbidden_files`), and the merge policy refuses a
 * self-merge whatever the verdict said. The lists are patterns on the path
 * GitHub reports, repo-relative.
 */
export const BUG_HUNT_PERSON_ONLY_PATTERNS: { pattern: RegExp; why: string }[] =
  [
    { pattern: /^\.claude\//, why: 'Bug Hunter agent files' },
    { pattern: /^\.github\//, why: 'workflows and CI' },
    { pattern: /(^|\/)pr-body\.md$/, why: 'a PR body written into the repo' },
    { pattern: /(^|\/)migrations\//, why: 'a database migration' },
    { pattern: /(^|\/)locales\/[^/]+\.json$/, why: 'a locale file' },
    { pattern: /(^|\/)seeds?\//, why: 'seed data' },
    { pattern: /(^|\/)__snapshots__\//, why: 'a test snapshot' },
    { pattern: /\.snap$/, why: 'a test snapshot' },
    {
      pattern:
        /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock)$/,
      why: 'a lockfile',
    },
    { pattern: /(^|\/)generated\//, why: 'generated output' },
  ];

export interface PersonOnlyPath {
  file: string;
  why: string;
}

/** The files in a diff a person has to merge, with the reason for each. Empty when the diff is clean. */
export function personOnlyPaths(files: readonly string[]): PersonOnlyPath[] {
  const out: PersonOnlyPath[] = [];
  for (const file of files) {
    const hit = BUG_HUNT_PERSON_ONLY_PATTERNS.find(({ pattern }) =>
      pattern.test(file),
    );
    if (hit) out.push({ file, why: hit.why });
  }
  return out;
}

/** One line a reviewer or a retry can read: "pr-body.md (a PR body written into the repo), .claude/agents/x.md (Bug Hunter agent files)". */
export function describePersonOnlyPaths(hits: PersonOnlyPath[]): string {
  return hits
    .slice(0, 8)
    .map((h) => `${h.file} (${h.why})`)
    .join(', ')
    .concat(hits.length > 8 ? `, and ${hits.length - 8} more` : '');
}
