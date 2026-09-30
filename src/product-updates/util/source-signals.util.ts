/**
 * Deterministic signals about one merged change — everything this module can
 * decide without a model.
 *
 * Two jobs:
 *
 *  1. **Grouping evidence.** A feature routinely lands as several merges across
 *     repos (an ally-be endpoint and the ally-web screen that reads it, then a
 *     day of follow-up fixes). The hard evidence that two merges are one change
 *     is structural: the same branch name (`/ship` reuses one across repos — 130
 *     branches did in the first seven weeks), a PR body linking the sibling PR,
 *     a shared roadmap or chart id, or one author working one commit scope over
 *     a couple of days. Those become cluster keys here; the model only has to
 *     judge what the keys cannot see.
 *  2. **Noise.** Tests, lint, docs, version bumps and wiki syncs change nothing
 *     for anyone. Recognising them from file paths and commit types costs
 *     nothing and keeps them out of the model call entirely.
 */

export interface SourceSignalsInput {
  repo: string;
  author: string | null;
  mergedAt: Date;
  /** PR head branch; null for a direct push. */
  headRef: string | null;
  prNumber: number | null;
  /** PR title, or every commit subject of a direct push. */
  subjects: string[];
  /** PR body, or the joined commit bodies. */
  body: string | null;
  files: string[];
}

/** Branch names that many unrelated changes share, so they prove nothing. */
const GENERIC_BRANCHES = new Set([
  'chore/sync-wiki-routing',
  'master',
  'main',
  'develop',
]);

/**
 * Commit scopes too broad to mean "the same feature" — `fix(helpline)` is used
 * for every kind of consumer-app fix, `feat(admin)` for any admin screen.
 */
const GENERIC_SCOPES = new Set([
  'admin',
  'admin-dashboard',
  'helpline',
  'web',
  'be',
  'api',
  'ui',
  'app',
  'mobile',
  'lint',
  'test',
  'tests',
  'deps',
  'ci',
  'docs',
  'chore',
  'release',
  'migrations',
  'llm',
  'prompts',
  'config',
  'auth',
  'types',
  'i18n',
]);

/** Authors whose every change is its own finding — never chained by scope. */
const BOT_AUTHOR = /bughunter|bug-hunter|buider|builder|\[bot\]|docs-bot/i;

const CONVENTIONAL = /^\s*(\w+)(?:\(([^)]*)\))?!?:\s*/;
const TICKET = /\b(OPP-\d{3,5}|AAQ-\d{3})\b/g;
const CROSS_LINK_SHORT = /\b(ally-(?:be|web|ai-learn|ai|mobile))\s*#(\d+)\b/g;
const CROSS_LINK_URL =
  /github\.com\/HelloAllyTech\/(ally-(?:be|web|ai-learn|ai|mobile))\/pull\/(\d+)/g;

/**
 * Files whose change alters nothing a person using Ally could notice. A change
 * made only of these is noise; a change that includes one real source file is
 * not.
 */
const NON_BEHAVIOURAL = [
  /(^|\/)docs?\//,
  /\.mdx?$/,
  /(^|\/)__tests__\//,
  /(^|\/)tests?\//,
  /\.(spec|test)\.[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /^\.github\//,
  /^\.husky\//,
  /^\.claude\//,
  /(^|\/)\.eslintrc/,
  /(^|\/)\.prettierrc/,
  /(^|\/)(jest|vitest)\.config\./,
  /(^|\/)\.docs-map\.yml$/,
  /(^|\/)WIKI-ROUTING\.md$/,
  /(^|\/)(CLAUDE|AGENTS)\.md$/,
  /(^|\/)scripts\/color-literal-baseline\.json$/,
];

const NOISE_SUBJECT =
  /\bbump version\b|\bsync wiki\b|wiki routing|^\w+\((lint|prettier|eslint|formatting)\)|^(lint|prettier)\b|\[automated\]/i;
const NOISE_TYPES = new Set(['test', 'tests', 'docs', 'style', 'ci', 'build']);

export function normaliseBranch(ref: string | null): string | null {
  if (!ref) return null;
  const lower = ref.toLowerCase();
  if (GENERIC_BRANCHES.has(lower)) return null;
  return lower.replace(
    /^(feat|feature|fix|chore|docs|refactor|perf|builder|bug-hunter|bughunter)\//,
    '',
  );
}

export function conventionalScopes(subject: string): string[] {
  const match = CONVENTIONAL.exec(subject);
  if (!match || !match[2]) return [];
  return match[2]
    .toLowerCase()
    .split(/[,/]/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function conventionalType(subject: string): string | null {
  const match = CONVENTIONAL.exec(subject);
  return match ? match[1].toLowerCase() : null;
}

/** `pr:ally-be#571`-style references this change makes to other PRs. */
export function linkedPullRequests(body: string | null): string[] {
  if (!body) return [];
  const refs = new Set<string>();
  for (const pattern of [CROSS_LINK_SHORT, CROSS_LINK_URL]) {
    for (const match of body.matchAll(pattern)) {
      refs.add(`pr:${match[1]}#${match[2]}`);
    }
  }
  return [...refs];
}

export function tickets(text: string): string[] {
  return [...new Set([...text.matchAll(TICKET)].map((match) => match[1]))];
}

/**
 * Keys two changes must share to be put in one cluster before the model sees
 * them. Scope chaining is not here: it depends on time between changes, so
 * `buildClusters` does it.
 */
export function clusterKeys(source: SourceSignalsInput): string[] {
  const keys = new Set<string>();
  const branch = normaliseBranch(source.headRef);
  if (branch) keys.add(`branch:${branch}`);
  if (source.prNumber !== null) {
    keys.add(`pr:${source.repo}#${source.prNumber}`);
  }
  for (const ref of linkedPullRequests(source.body)) keys.add(ref);
  for (const ticket of tickets(
    [...source.subjects, source.body ?? ''].join('\n'),
  )) {
    keys.add(`ticket:${ticket}`);
  }
  return [...keys];
}

/** A change that can only ever be noise — decided with no model call. */
export function isNoise(source: SourceSignalsInput): boolean {
  if (source.author && /docs-bot/i.test(source.author)) return true;
  if (
    source.subjects.length > 0 &&
    source.subjects.every((subject) => NOISE_SUBJECT.test(subject))
  ) {
    return true;
  }
  if (source.files.length > 0 && source.files.every(isNonBehaviouralFile)) {
    return true;
  }
  // Every subject typed as tests/docs/CI/style, and no file list to say
  // otherwise, is still noise: conventional types are the author's own claim.
  return (
    source.files.length === 0 &&
    source.subjects.length > 0 &&
    source.subjects.every((subject) =>
      NOISE_TYPES.has(conventionalType(subject) ?? ''),
    )
  );
}

export function isNonBehaviouralFile(path: string): boolean {
  return NON_BEHAVIOURAL.some((pattern) => pattern.test(path));
}

/**
 * Whether this change should hold an update back from "live". A change that
 * is only tests or docs ships nothing, so waiting on its repo's release would
 * keep a feature marked unreleased for no reason.
 */
export function gatesLiveness(source: SourceSignalsInput): boolean {
  if (source.files.length === 0) return true;
  return !source.files.every(isNonBehaviouralFile);
}

/**
 * Union-find over `clusterKeys`, plus one time-dependent rule: a human
 * author's direct pushes that share a specific commit scope within
 * `chainWindowMs` of each other are the same piece of work (Gopi's ten
 * `openers` commits over two days). Bots are never chained this way — every
 * Bug Hunter fix is its own finding, however many share `fix(helpline)`.
 *
 * Returns clusters as arrays of indexes into `sources`, oldest first.
 */
export function buildClusters(
  sources: SourceSignalsInput[],
  chainWindowMs = 48 * 60 * 60 * 1000,
): number[][] {
  const parent = sources.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootA] = rootB;
  };

  const byKey = new Map<string, number>();
  sources.forEach((source, index) => {
    for (const key of clusterKeys(source)) {
      const other = byKey.get(key);
      if (other === undefined) byKey.set(key, index);
      else union(index, other);
    }
  });

  const order = sources
    .map((source, index) => ({ index, at: source.mergedAt.getTime() }))
    .sort((a, b) => a.at - b.at);
  const lastByScope = new Map<string, { index: number; at: number }>();
  for (const { index, at } of order) {
    const source = sources[index];
    // Pull requests are grouped by branch, links and ids; chaining them by
    // scope too glued unrelated work together (two different analytics charts
    // one person shipped the same afternoon, both `feat(analytics)`). A direct
    // push has none of that evidence, so it is the only kind chained by scope.
    if (source.prNumber !== null) continue;
    if (!source.author || BOT_AUTHOR.test(source.author)) continue;
    const scopes = new Set(
      source.subjects
        .flatMap(conventionalScopes)
        .filter((scope) => !GENERIC_SCOPES.has(scope)),
    );
    for (const scope of scopes) {
      const key = `${source.author}\n${scope}`;
      const last = lastByScope.get(key);
      if (last && at - last.at <= chainWindowMs) union(index, last.index);
      lastByScope.set(key, { index, at });
    }
  }

  const groups = new Map<number, number[]>();
  for (const { index } of order) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(index);
    groups.set(root, group);
  }
  return [...groups.values()];
}

/**
 * Admin console areas only Ally's own team uses. A change confined to these is
 * never customer news, however the model is tempted to phrase it — "You can
 * now choose Gemini as an AI engine for Bug Hunter" reached the public page
 * five times in one morning under the old per-merge drafter.
 */
const STAFF_ONLY_PATHS = [
  /^src\/(bug-hunter|builder|product-roadmap|analytics|analytics-agent|analytics-suggestions|ux-signals|mobile-releases|lab|logs|release|github|changelog|product-updates|blog)\//,
  /^src\/llm\/constants\/ai-task-registry/,
  /^apps\/ally-admin-dashboard\/src\/pages\/(AILab|AiTasks|Analytics|Blog|BugHunter|Builder|DesignSystem|LanguageGlossary|LlmModelCatalog|Logs|MobileReleases|ProductRoadmap|ProductUpdates|PromptManagement|SttConfigs|SuperAdmins|Tooltips|TranslationManagement)\//,
  /(^|\/)scripts\//,
];

/** Code that runs in front of customers: the web app's screens, the mobile app, the voice agent. */
const CUSTOMER_SURFACE_PATHS: [string | null, RegExp][] = [
  [
    null,
    /^apps\/ally-helpline-dashboard\/src\/(pages|components|hooks|features|layouts)\//,
  ],
  [
    'ally-mobile',
    /^src\/(screens|components|hooks|navigation|features|services)\//,
  ],
  ['ally-ai-learn', /^app\//],
];

/**
 * Commit scopes that only ever name staff tools. A change whose every subject
 * carries one is staff-only even when its files sit in shared components —
 * the Builder notification bell lives in `components/`, not `pages/Builder/`.
 */
const STAFF_ONLY_SCOPES = new Set([
  'bug-hunter',
  'builder',
  'product-roadmap',
  'roadmap',
  'admin/roadmap',
  'analytics',
  'admin-analytics',
  'admin/analytics',
  'analytics-agent',
  'llm-usage',
  'ux-signals',
  'mobile-releases',
  'ai-registry',
  'ai-task-registry',
  'glossary',
  'changelog',
  'product-updates',
]);

/**
 * Plumbing every feature touches — API clients, constants, types, routes,
 * migrations, module wiring. A change to these says nothing about who will
 * see the feature, so they neither make a change staff-only nor stop it being.
 */
const NEUTRAL_PATHS = [
  /^apps\/ally-(admin|helpline)-dashboard\/src\/(api|constants|types|routes|utils|assets|test-setup)/,
  /^src\/(database|config|common|authorization)\//,
  /^src\/app\.module\.ts$/,
  /^src\/learn\/enum\/llm-task\.enum\.ts$/,
  /^src\/prompts\//,
  /^DATA_SCHEMA\.md$/,
];

/**
 * True when a change is confined to staff-only areas — every file that says
 * where the change shows up sits in one, or it names an admin analytics chart
 * (`AAQ-123` ids belong to the super-admin chart registry). The consolidation
 * job enforces this as a verdict, not a hint: a cluster made only of such
 * changes is never public, whatever the model says.
 */
export function looksStaffOnly(source: SourceSignalsInput): boolean {
  // A change that reaches a customer app is never staff-only, whatever its
  // commit scope says: `fix(helpline/analytics)` is the organisation admin's
  // Statistics page, which customers see.
  if (
    source.files.some(
      (path) =>
        !isNonBehaviouralFile(path) &&
        CUSTOMER_SURFACE_PATHS.some(
          ([repo, pattern]) =>
            (repo === null || repo === source.repo) && pattern.test(path),
        ),
    )
  ) {
    return false;
  }
  if (
    source.subjects.length > 0 &&
    source.subjects.every(
      (subject) =>
        /^\s*(bug hunter|builder)\s*:/i.test(subject) ||
        conventionalScopes(subject).some((scope) =>
          STAFF_ONLY_SCOPES.has(scope),
        ),
    )
  ) {
    return true;
  }
  if (
    tickets([...source.subjects, source.body ?? ''].join('\n')).some((ticket) =>
      ticket.startsWith('AAQ-'),
    )
  ) {
    return true;
  }
  const telling = source.files.filter(
    (path) =>
      !isNonBehaviouralFile(path) &&
      !NEUTRAL_PATHS.some((pattern) => pattern.test(path)),
  );
  return (
    telling.length > 0 &&
    telling.every((path) =>
      STAFF_ONLY_PATHS.some((pattern) => pattern.test(path)),
    )
  );
}
