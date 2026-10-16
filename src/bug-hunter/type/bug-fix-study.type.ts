/**
 * The study a fix session writes BEFORE it changes any code: how the feature
 * works today, where the value the bug is about actually lives, and the plan
 * that follows from that.
 *
 * ## Why
 *
 * On 2026-10-10 a session fixed "tooltips stay in English after the language
 * switch" by copying three tooltip strings into the locale files. Tooltips
 * are rows in a table an admin edits under Manage Tooltips, served by an
 * endpoint that already translates them; the real gap was that the app never
 * sent its language. The session had read the symptom and the nearest file,
 * not the feature. A person reading the same code would have traced the
 * tooltip from the table to the screen first and seen the mechanism.
 *
 * So a session now studies first, the way an engineer new to the codebase
 * would, and writes the study down. The study is reviewed by a second model
 * for the classic wrong turns (a parallel mechanism, a header nobody sends),
 * rendered into the PR body so a reviewer sees the reasoning, and handed to
 * the Verifier, which checks the diff against it. A retry reads the previous
 * session's study, because a wrong fix usually starts from a wrong study.
 *
 * Stored under `bug_findings.metadata.study` (latest wins) and as a `study`
 * event on the timeline (one per session), like the post-mortem.
 */
export const BUG_FIX_STUDY_VALUE_HOMES = [
  /** A table an admin or a user edits — tooltips, prompts, templates, settings. */
  'database',
  /** The i18n locale JSON files — labels that only exist in code. */
  'locale_file',
  /** Environment, feature flags, a config file. */
  'config',
  /** A constant or logic in code. */
  'code',
  /** The value comes from another Ally repo (a backend field the client renders, or the reverse). */
  'other_repo',
  /** Genuinely split between two of the above — the study says how. */
  'mixed',
] as const;
export type BugFixStudyValueHome = (typeof BUG_FIX_STUDY_VALUE_HOMES)[number];

export interface BugFixStudyReview {
  /** What a second model found wrong or unproven in the study; empty when it had nothing. */
  concerns: string[];
  model: string | null;
  at: string;
}

export interface BugFixStudy {
  /** The user-facing feature, in one line. */
  feature: string;
  /** Files, routes or components where the symptom shows. */
  entryPoints: string[];
  /** The path from where the value is stored to where it is shown, one step per line, each naming a file or symbol. */
  howItWorksToday: string[];
  valueLivesIn: BugFixStudyValueHome;
  /** One instance of the same kind of thing done right in this repo — file or symbol. */
  workingSibling: string | null;
  rootCause: string;
  /** The fix, inside the mechanism the study found. */
  approach: string;
  filesToChange: string[];
  /** What the session will deliberately not touch, and why. */
  leaveAlone: string[];
  /** Repos a complete fix also needs; non-empty means the cross-repo plan path. */
  otherRepos: string[];
  /**
   * Who else reads the value the fix changes, and how the session looked.
   * Added 2026-10-16: an OTP-length fix changed the backend from 4 to 6
   * digits, wrote "clients might have front-end validation that expects a
   * 4-digit code" in its own risks, listed no other repo, and opened a
   * backend-only PR — twice more in later sweeps. A value another repo reads
   * (a length, a format, an enum, a field, a response shape) is a contract,
   * and changing one side is a half-fix. `search` is the command run over
   * this repo and /tmp/siblings; `found` is one line per reader,
   * "<repo>: <file> — how it uses the value". Older studies carry an empty
   * search.
   */
  consumers: { search: string; found: string[] };
  risks: string[];
  /** The regression test: what it asserts and where. */
  testPlan: string;
  /** On a retry: what the previous session's study got wrong. */
  previousStudyWasWrongBecause: string | null;
  recordedAt: string;
  runId: string | null;
  review: BugFixStudyReview | null;
}

/** Fields a study cannot do without; a POST missing one is refused with their names. */
export const BUG_FIX_STUDY_REQUIRED: (keyof BugFixStudy)[] = [
  'feature',
  'howItWorksToday',
  'valueLivesIn',
  'rootCause',
  'approach',
  'filesToChange',
  'testPlan',
];

/** Fewest steps a "how it works today" can have and still be a trace rather than a guess. */
export const BUG_FIX_STUDY_MIN_STEPS = 2;

const STR_MAX = 1200;

const str = (v: unknown, max = STR_MAX): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null;
};

const strList = (v: unknown, max = 40): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, 400))
        .filter((x): x is string => x !== null)
        .slice(0, max)
    : [];

/**
 * A study from the body a session POSTed, or the names of what is missing.
 * Unknown values are dropped, never trusted; a `valueLivesIn` off the menu
 * counts as missing, because that field is the one the whole idea rests on.
 */
export function toBugFixStudy(
  raw: Record<string, unknown> | null | undefined,
  ctx: {
    runId: string | null;
    now?: Date;
    /** Reading a stored study: fields added later are not required of it. */
    lenient?: boolean;
  },
): { study: BugFixStudy; missing: [] } | { study: null; missing: string[] } {
  const r = raw && typeof raw === 'object' ? raw : {};
  const missing: string[] = [];

  const feature = str(r.feature, 300);
  if (!feature) missing.push('feature');
  const howItWorksToday = strList(r.howItWorksToday);
  if (howItWorksToday.length < BUG_FIX_STUDY_MIN_STEPS)
    missing.push(
      `howItWorksToday (at least ${BUG_FIX_STUDY_MIN_STEPS} steps, each naming a file or symbol)`,
    );
  const valueLivesIn = BUG_FIX_STUDY_VALUE_HOMES.includes(
    r.valueLivesIn as never,
  )
    ? (r.valueLivesIn as BugFixStudyValueHome)
    : null;
  if (!valueLivesIn)
    missing.push(
      `valueLivesIn (one of ${BUG_FIX_STUDY_VALUE_HOMES.join(', ')})`,
    );
  const rootCause = str(r.rootCause);
  if (!rootCause) missing.push('rootCause');
  const approach = str(r.approach);
  if (!approach) missing.push('approach');
  const filesToChange = strList(r.filesToChange);
  if (!filesToChange.length) missing.push('filesToChange');
  const testPlan = str(r.testPlan);
  if (!testPlan) missing.push('testPlan');
  const rawConsumers =
    r.consumers && typeof r.consumers === 'object'
      ? (r.consumers as Record<string, unknown>)
      : {};
  const consumers = {
    search: str(rawConsumers.search, 400) ?? '',
    found: strList(rawConsumers.found, 15),
  };
  if (!ctx.lenient && !consumers.search)
    missing.push(
      'consumers.search (the search you ran over this repo AND /tmp/siblings for everything that reads the value you change; "found" lists each reader as "<repo>: <file> — how it uses it", or [] when there is none)',
    );

  if (missing.length) return { study: null, missing };

  return {
    study: {
      feature: feature!,
      entryPoints: strList(r.entryPoints),
      howItWorksToday,
      valueLivesIn: valueLivesIn!,
      workingSibling: str(r.workingSibling, 400),
      rootCause: rootCause!,
      approach: approach!,
      filesToChange,
      leaveAlone: strList(r.leaveAlone),
      otherRepos: strList(r.otherRepos, 8),
      consumers,
      risks: strList(r.risks, 10),
      testPlan: testPlan!,
      previousStudyWasWrongBecause: str(r.previousStudyWasWrongBecause, 600),
      recordedAt: (ctx.now ?? new Date()).toISOString(),
      runId: ctx.runId,
      review: null,
    },
    missing: [],
  };
}

/** `metadata.study` back into a study, or null when there is none or it predates the shape. */
export function readBugFixStudy(
  metadata: Record<string, unknown> | null | undefined,
): BugFixStudy | null {
  const raw = metadata?.study;
  if (!raw || typeof raw !== 'object') return null;
  const parsed = toBugFixStudy(raw as Record<string, unknown>, {
    runId: typeof (raw as any).runId === 'string' ? (raw as any).runId : null,
    lenient: true,
  });
  if (!parsed.study) return null;
  const review = (raw as any).review;
  return {
    ...parsed.study,
    recordedAt:
      typeof (raw as any).recordedAt === 'string'
        ? (raw as any).recordedAt
        : parsed.study.recordedAt,
    review:
      review && typeof review === 'object' && Array.isArray(review.concerns)
        ? {
            concerns: review.concerns.filter(
              (c: unknown) => typeof c === 'string',
            ),
            model: typeof review.model === 'string' ? review.model : null,
            at: typeof review.at === 'string' ? review.at : '',
          }
        : null,
  };
}

export const BUG_FIX_STUDY_HOME_WORDS: Record<BugFixStudyValueHome, string> = {
  database: 'a database table (admin-editable content)',
  locale_file: 'the locale JSON files',
  config: 'configuration',
  code: 'code',
  other_repo: 'another Ally repo',
  mixed: 'more than one place',
};

/**
 * The study as prose lines, for the three readers that quote it: the fix
 * dossier on a retry, the Verifier's brief and the PR body. Every value was
 * written by a model, so callers wrap these in DATA markers where that
 * matters.
 */
export function renderBugFixStudyLines(
  study: BugFixStudy,
  opts: { bullet?: string } = {},
): string[] {
  const b = opts.bullet ?? '- ';
  const lines = [
    `${b}Feature: ${study.feature}`,
    ...(study.entryPoints.length
      ? [`${b}Where the symptom shows: ${study.entryPoints.join('; ')}`]
      : []),
    `${b}How it works today:`,
    ...study.howItWorksToday.map((s, i) => `    ${i + 1}. ${s}`),
    `${b}The value lives in: ${BUG_FIX_STUDY_HOME_WORDS[study.valueLivesIn]}`,
    ...(study.workingSibling
      ? [`${b}Working sibling compared against: ${study.workingSibling}`]
      : []),
    `${b}Root cause: ${study.rootCause}`,
    `${b}Approach: ${study.approach}`,
    `${b}Files to change: ${study.filesToChange.join(', ')}`,
    ...(study.leaveAlone.length
      ? [`${b}Left alone on purpose: ${study.leaveAlone.join('; ')}`]
      : []),
    ...(study.otherRepos.length
      ? [`${b}Other repos a complete fix needs: ${study.otherRepos.join(', ')}`]
      : []),
    ...(study.consumers?.search
      ? [
          study.consumers.found.length
            ? `${b}Who else reads it: ${study.consumers.found.join('; ')}`
            : `${b}Who else reads it: nobody found`,
          `${b}Searched with: ${study.consumers.search}`,
        ]
      : []),
    ...(study.risks.length ? [`${b}Risks: ${study.risks.join('; ')}`] : []),
    `${b}Test plan: ${study.testPlan}`,
    ...(study.previousStudyWasWrongBecause
      ? [
          `${b}What the previous study got wrong: ${study.previousStudyWasWrongBecause}`,
        ]
      : []),
  ];
  if (study.review) {
    lines.push(
      study.review.concerns.length
        ? `${b}Review${study.review.model ? ` by ${study.review.model}` : ''} raised: ${study.review.concerns.join(' | ')}`
        : `${b}Review${study.review.model ? ` by ${study.review.model}` : ''}: no concerns.`,
    );
  }
  return lines;
}

const ALLY_REPOS = [
  'ally-be',
  'ally-web',
  'ally-mobile',
  'ally-ai',
  'ally-ai-learn',
] as const;

/** The Ally repo a consumer line names first, e.g. "ally-web: apps/…" → ally-web. */
const repoOfConsumer = (line: string): string | null => {
  const m = /^\s*(ally-[a-z-]+?)(?=[\s:/(—-]|$)/i.exec(line);
  const name = m?.[1]?.toLowerCase() ?? null;
  return name && (ALLY_REPOS as readonly string[]).includes(name) ? name : null;
};

/** Risk wording that says another app may break, which the study must then follow up. */
const CLIENT_BREAK =
  /\b(break(s|ing)?\b.*\b(client|front-?end|mobile|web|app)s?\b|(client|front-?end|mobile|web|app)s?\b.*\b(break|expects?|validat\w*|assum\w*|hard-?coded)|breaking change)/i;

/**
 * Null when the study's plan covers everyone who reads the value it
 * changes; otherwise the reason to refuse it. Two contradictions:
 *  - a consumer it found sits in another Ally repo that "otherRepos" leaves
 *    out — the fix would change one side of a contract;
 *  - its own risks say a client may break, yet it names no other repo, no
 *    consumer in another repo, and nothing in "leaveAlone" says why that
 *    client is unaffected.
 * Not applied to a step of an existing cross-repo plan: its siblings are
 * the plan's other steps.
 */
export function studyLeavesConsumersBehind(
  study: Pick<BugFixStudy, 'otherRepos' | 'consumers' | 'risks' | 'leaveAlone'>,
  repo: string,
): string | null {
  const other = new Set(study.otherRepos.map((r) => r.trim().toLowerCase()));
  const outside = [
    ...new Set(
      (study.consumers?.found ?? [])
        .map(repoOfConsumer)
        .filter((r): r is string => !!r && r !== repo),
    ),
  ];
  const uncovered = outside.filter((r) => !other.has(r));
  if (uncovered.length) {
    return (
      `Your study found readers of the value you change in ${uncovered.join(', ')}, and "otherRepos" leaves ${uncovered.length === 1 ? 'it' : 'them'} out. ` +
      `Changing one side of a contract is a half-fix that looks finished. Add ${uncovered.join(', ')} to "otherRepos" and hand back a cross-repo plan (step 2a) instead of fixing ${repo} alone.`
    );
  }
  const riskLine = study.risks.find((r) => CLIENT_BREAK.test(r));
  const explained = study.leaveAlone.some((l) =>
    /\bally-[a-z-]+|client|front-?end|mobile|web app/i.test(l),
  );
  if (riskLine && !other.size && !outside.length && !explained) {
    return (
      `Your own risks say another app may break ("${riskLine.slice(0, 200)}"), but the study names no other repo and no reader outside ${repo}. ` +
      `Search /tmp/siblings for that client's use of the value. If it reads it, list it in "consumers.found" and "otherRepos" and plan across repos; if it does not, say why in "leaveAlone".`
    );
  }
  return null;
}
