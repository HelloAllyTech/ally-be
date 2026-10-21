import { BUILDER_REPO_NAMES } from '../constants/builder-repos.constants';

/**
 * The text-reading half of the readiness rubric's meaning checks: which repos
 * a section assigns work to, which file paths it cites, whether a message is
 * only an acknowledgement. Pure, so each rule can be pinned by a unit test
 * against the prose that motivated it.
 */

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Repos a section gives a line of work to — "- ally-be: the count is computed
 * here" — as opposed to any mention at all.
 *
 * Naming a repo to rule it out ("nothing in ally-web renders them yet") is a
 * normal, useful thing to write, and a check that counted it would teach
 * people to stop writing it. The looser reading was tried first and flagged
 * exactly that sentence.
 */
export function reposOwningALine(text: string): string[] {
  const source = String(text ?? '');
  return BUILDER_REPO_NAMES.filter((repo) =>
    new RegExp(
      `^[\\s>*\\-\\d.\`]*\\*{0,2}${escapeRegExp(repo)}\\*{0,2}\`?\\s*[:—-]`,
      'im',
    ).test(source),
  );
}

/**
 * Repos a test plan puts tests in: a repo owning a line, or a path rooted in
 * one (`ally-ai/tests/test_challenger.py`). The second form is how test plans
 * usually name a file, and it is unambiguous — nobody writes a path into a
 * repo to say the repo is untouched.
 */
export function reposATestPlanTouches(text: string): string[] {
  const source = String(text ?? '');
  const owned = new Set(reposOwningALine(source));
  for (const repo of BUILDER_REPO_NAMES) {
    if (
      new RegExp(`(^|[\\s\`'"(])${escapeRegExp(repo)}/[\\w.-]`, 'm').test(
        source,
      )
    ) {
      owned.add(repo);
    }
  }
  return BUILDER_REPO_NAMES.filter((repo) => owned.has(repo));
}

/** True when `id` appears in `text` as a whole token ("R1" in "(R1, R3)", not in "R10"). */
export function mentionsId(text: string, id: string): boolean {
  const trimmed = String(id ?? '').trim();
  if (!trimmed) return false;
  return new RegExp(
    `(^|[^A-Za-z0-9_-])${escapeRegExp(trimmed)}(?![A-Za-z0-9_])`,
  ).test(String(text ?? ''));
}

/** True when `name` appears as an identifier — `DebriefTab`, not `DebriefTabs` or "debrief tab". */
export function mentionsIdentifier(text: string, name: string): boolean {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return false;
  return new RegExp(
    `(^|[^A-Za-z0-9_])${escapeRegExp(trimmed)}(?![A-Za-z0-9_])`,
  ).test(String(text ?? ''));
}

const FILE_EXTENSION =
  /\.(tsx?|jsx?|mjs|cjs|py|md|json|ya?ml|sql|txt|sh|kt|swift|css|scss|html)$/i;

/** First path segments that mark a token as a repo path rather than "web/mobile". */
const PATH_ROOTS = new Set([
  ...BUILDER_REPO_NAMES,
  'src',
  'apps',
  'app',
  'libs',
  'lib',
  'packages',
  'docs',
  'wiki',
  'scripts',
  'test',
  'tests',
  'components',
  '.github',
]);

/**
 * File paths a section cites: tokens with a file extension, or slash paths
 * rooted in a repo or a source directory. Backticked or bare.
 *
 * Deliberately misses slash phrases like "thumbs-up/down" and "web/mobile",
 * which are prose, and URLs, which are not repo paths.
 */
export function citedPaths(text: string): string[] {
  // URLs out first: split at their `#` or `?`, their tail reads as a path.
  const source = String(text ?? '').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ');
  const tokens = new Set<string>();
  for (const match of source.matchAll(/`([^`\n]+)`/g)) {
    tokens.add(match[1]);
  }
  for (const match of source.matchAll(/[A-Za-z0-9_@.[\]:/-]+/g)) {
    tokens.add(match[0]);
  }

  const paths = new Set<string>();
  for (const raw of tokens) {
    const token = raw
      .trim()
      .replace(/[.,;:)]+$/, '')
      .replace(/^\(+/, '');
    if (!token || /\s/.test(token) || /^[a-z]+:\/\//i.test(token)) continue;
    // "ally-be:src/x.ts" (how the evidence log writes it) → "ally-be/src/x.ts".
    const normalised = token.replace(/^([\w.-]+):(?=[\w./-])/, '$1/');
    const segments = normalised.split('/').filter(Boolean);
    const isFile = FILE_EXTENSION.test(normalised) && !normalised.includes('*');
    const isRootedPath =
      segments.length >= 2 && PATH_ROOTS.has(segments[0].toLowerCase());
    if (isFile || isRootedPath) {
      paths.add(normalised.replace(/\/+$/, ''));
    }
  }
  return [...paths];
}

/** A path with its repo prefix and `./` removed, lowercased, for comparison. */
function comparable(path: string): string {
  let value = String(path ?? '')
    .trim()
    .replace(/^([\w.-]+):(?=[\w./-])/, '$1/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  for (const repo of BUILDER_REPO_NAMES) {
    if (value.startsWith(`${repo.toLowerCase()}/`)) {
      value = value.slice(repo.length + 1);
      break;
    }
  }
  return value;
}

/**
 * Whether a cited path refers to something that was read.
 *
 * Generous on purpose, because the two sides are written by different hands:
 * the PRD may cite `DebriefTab.tsx` or `src/skill-experiment/` while the log
 * holds `ally-web:apps/…/DebriefTab.tsx` and
 * `ally-be:src/skill-experiment/constants/skill-experiment.constants.ts`. A
 * bare file name matches on base name; a directory matches any file under it;
 * otherwise one must be a path suffix of the other.
 */
export function citedPathMatchesRead(cited: string, read: string): boolean {
  const c = comparable(cited);
  const r = comparable(read);
  if (!c || !r) return false;
  if (c === r) return true;
  if (!c.includes('/')) {
    return r.split('/').pop() === c;
  }
  return r.endsWith(`/${c}`) || c.endsWith(`/${r}`) || r.startsWith(`${c}/`);
}

/**
 * Messages that answer nothing and so owe the PRD nothing: "ok", "thanks",
 * "looks good, go ahead". Shared with the validated-turn runtime, so the
 * other agents read an acknowledgement the same way.
 */
export { isAcknowledgement } from 'src/llm-agent/runtime/agent-turn-words.util';
