import type { FoundationalSkillsLearnerCutRow } from '../repository/foundational-skills-analytics.repository';
import {
  FHS_PROGRESS_THRESHOLDS,
  ProgressLearner,
  computeProgress,
  cutNoiseSd,
  hasCompleteRun,
  learnerTrend,
} from './foundational-skills-progress.util';
import { pairedChange } from './paired-stats.util';

/**
 * The arithmetic behind Highlights → Effectiveness: where learners fall out of
 * the chain (EFF-02, AAQ-203) and whether the Helping skills headline holds in
 * every segment (EFF-03, AAQ-204).
 *
 * Pure functions over rows the repositories return, so every floor, clamp and
 * assignment rule is unit-tested without a database. Nothing here re-implements
 * a band, a panel or an interval: the noise band and trend classes are
 * `foundational-skills-progress.util`'s, the panel and windows are taken from
 * `computeProgress` itself, and the paired statistics are `paired-stats.util`'s
 * — so a number on this sub-tab cannot disagree with the Helping skills card it
 * summarises.
 */

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/* -------------------------------------------------------------------------- */
/* Grouping cut rows into learners                                            */
/* -------------------------------------------------------------------------- */

/** Where and when one scored cut happened — what segment assignment reads. */
export interface CutFacts {
  sessionIds: string[];
  closedAt: Date;
  tenantId: string | null;
}

export interface EffectivenessLearner extends ProgressLearner {
  /** Keyed by cut index (unique per learner under one rubric version). */
  facts: Map<number, CutFacts>;
}

/**
 * Fold `getAllLearnerCuts` rows into one series per learner — the same fold
 * `FoundationalSkillsAnalyticsService` applies before `computeProgress`
 * (learners in row order, i.e. by user id; cuts ascending; the learner's
 * `tenantId` is their latest non-null cut tenant), plus each cut's sessions,
 * close time and tenant. The order matters: the bootstrap resamples by
 * position, so a different learner order would draw a different interval for
 * the same data.
 */
export function groupCutRows(
  rows: readonly FoundationalSkillsLearnerCutRow[],
): EffectivenessLearner[] {
  const byUser = new Map<number, EffectivenessLearner>();
  for (const row of rows) {
    let learner = byUser.get(row.userId);
    if (!learner) {
      learner = {
        userId: row.userId,
        name: row.name,
        tenantId: row.tenantId,
        cuts: [],
        facts: new Map(),
      };
      byUser.set(row.userId, learner);
    }
    learner.tenantId = row.tenantId ?? learner.tenantId;
    learner.cuts.push({
      cut: row.cut,
      score: row.score,
      unhelpful: row.unhelpful,
      levels: row.levels,
      observed: new Set(row.verdicts.flatMap((v) => v.observed ?? [])),
    });
    learner.facts.set(row.cut, {
      sessionIds: row.sessionIds,
      closedAt: row.closedAt,
      tenantId: row.tenantId,
    });
  }
  for (const learner of byUser.values()) {
    learner.cuts.sort((a, b) => a.cut - b.cut);
  }
  return [...byUser.values()];
}

/* -------------------------------------------------------------------------- */
/* EFF-02 · Where learners fall out of the chain                              */
/* -------------------------------------------------------------------------- */

export type EffectivenessFunnelStageKey =
  | 'signedUp'
  | 'firstSession'
  | 'secondSession'
  | 'firstScoredCut'
  | 'measurable'
  | 'classifiable'
  | 'improving';

export interface EffectivenessFunnelStageDef {
  key: EffectivenessFunnelStageKey;
  label: string;
  description: string;
}

/**
 * The chain's stages, in order — declared once and echoed so the client's
 * labels and order come from the server. Each stage is a subset of the one
 * above it (see {@link buildEffectivenessFunnel}).
 */
export const EFFECTIVENESS_FUNNEL_STAGES: readonly EffectivenessFunnelStageDef[] =
  [
    {
      key: 'signedUp',
      label: 'Signed up',
      description:
        'Learner-role accounts (the activation funnel’s population), test organisations excluded',
    },
    {
      key: 'firstSession',
      label: 'Completed a session',
      description:
        'At least one countable roleplay: ended, completed, not a preview or seed room',
    },
    {
      key: 'secondSession',
      label: 'Completed two',
      description: 'At least two countable roleplays',
    },
    {
      key: 'firstScoredCut',
      label: 'First scored cut',
      description:
        'At least one 5,000-character slice of their own speech scored on the helping-skills rubric',
    },
    {
      key: 'measurable',
      label: 'Measurable (2+ cuts)',
      description:
        'Two or more scored cuts: enough for a start-vs-now comparison to exist',
    },
    {
      key: 'classifiable',
      label: 'Classifiable (4+ cuts)',
      description: `${FHS_PROGRESS_THRESHOLDS.trendMinCuts}+ scored cuts: enough for their own trend to be called up, steady or down`,
    },
    {
      key: 'improving',
      label: 'Improving beyond noise',
      description:
        'Last half of their cuts above their first half by more than the noise band (the Helping skills classification)',
    },
  ];

/** One learner-role account and how many countable sessions they completed. */
export interface FunnelPopulationRow {
  userId: number;
  countableSessions: number;
}

export interface EffectivenessFunnelStage {
  key: EffectivenessFunnelStageKey;
  label: string;
  description: string;
  reached: number;
  ofEnteredPct: number | null;
  ofPreviousPct: number | null;
  terminal: boolean;
}

export interface EffectivenessFunnelComputation {
  stages: EffectivenessFunnelStage[];
  trend: {
    classifiable: number;
    improving: number;
    steady: number;
    declining: number;
    unclassified: number;
    improvingPct: number | null;
    steadyPct: number | null;
    decliningPct: number | null;
  };
  clamp: {
    measuredLearners: number;
    outsideFunnel: number;
    notInPopulation: number;
    fewerThanTwoSessions: number;
  };
  helpingSkillsTrend: {
    improving: number;
    steady: number;
    declining: number;
    tooEarly: number;
  };
  cutNoiseSd: number | null;
}

/**
 * The chain as nested sets of people.
 *
 * Stages 1–3 come from the learner-role population and their countable
 * sessions; stages 4–7 from the scored cuts. The two sources are not nested
 * by construction — a long first session can fill a cut on its own, and a
 * trainer's practice is cut like anyone's — so every later stage is the
 * INTERSECTION with all the earlier ones, and `clamp` counts who that drops.
 * The trend is classified with the noise of EVERY measured learner (the
 * Helping skills AAQ-181 band), then counted inside the funnel only.
 */
export function buildEffectivenessFunnel(input: {
  population: readonly FunnelPopulationRow[];
  cutLearners: readonly ProgressLearner[];
  minCohort: number;
  sampleFloor: number;
}): EffectivenessFunnelComputation {
  const { population, cutLearners, minCohort, sampleFloor } = input;

  const inPopulation = new Set(population.map((p) => p.userId));
  const firstSession = new Set(
    population.filter((p) => p.countableSessions >= 1).map((p) => p.userId),
  );
  const secondSession = new Set(
    population.filter((p) => p.countableSessions >= 2).map((p) => p.userId),
  );

  // AAQ-181's classification, untouched: noise from everyone measured.
  const noise = cutNoiseSd(cutLearners);
  const trends = new Map(
    cutLearners.map((l) => [l.userId, learnerTrend(l, noise).trend]),
  );
  const helpingSkillsTrend = {
    improving: 0,
    steady: 0,
    declining: 0,
    tooEarly: 0,
  };
  for (const t of trends.values()) helpingSkillsTrend[t] += 1;

  const inFunnel = cutLearners.filter((l) => secondSession.has(l.userId));
  const scored = inFunnel.filter((l) => l.cuts.length >= 1);
  const measurable = scored.filter((l) => l.cuts.length >= 2);
  const classifiable = measurable.filter(
    (l) => l.cuts.length >= FHS_PROGRESS_THRESHOLDS.trendMinCuts,
  );
  const trend = { improving: 0, steady: 0, declining: 0, unclassified: 0 };
  for (const l of classifiable) {
    const t = trends.get(l.userId);
    if (t === 'improving' || t === 'steady' || t === 'declining') {
      trend[t] += 1;
    } else {
      // 4+ cuts but no noise estimate to compare against.
      trend.unclassified += 1;
    }
  }

  const counts: Record<EffectivenessFunnelStageKey, number> = {
    signedUp: inPopulation.size,
    firstSession: firstSession.size,
    secondSession: secondSession.size,
    firstScoredCut: scored.length,
    measurable: measurable.length,
    classifiable: classifiable.length,
    improving: trend.improving,
  };

  const share = (num: number, den: number): number | null =>
    den > 0 && den >= minCohort ? round1((num / den) * 100) : null;
  const trendShown = classifiable.length >= sampleFloor;

  const entered = counts.signedUp;
  let previous: number | null = null;
  const stages = EFFECTIVENESS_FUNNEL_STAGES.map((def) => {
    const reached = counts[def.key];
    const withheld = def.key === 'improving' && !trendShown;
    const stage: EffectivenessFunnelStage = {
      key: def.key,
      label: def.label,
      description: def.description,
      reached,
      ofEnteredPct: withheld ? null : share(reached, entered),
      ofPreviousPct:
        withheld || previous === null ? null : share(reached, previous),
      terminal: def.key === 'improving',
    };
    previous = reached;
    return stage;
  });

  const trendPct = (k: number) =>
    trendShown ? round1((k / classifiable.length) * 100) : null;

  const outside = cutLearners.filter((l) => !secondSession.has(l.userId));
  return {
    stages,
    trend: {
      classifiable: classifiable.length,
      ...trend,
      improvingPct: trendPct(trend.improving),
      steadyPct: trendPct(trend.steady),
      decliningPct: trendPct(trend.declining),
    },
    clamp: {
      measuredLearners: cutLearners.length,
      outsideFunnel: outside.length,
      notInPopulation: outside.filter((l) => !inPopulation.has(l.userId))
        .length,
      fewerThanTwoSessions: outside.filter((l) => inPopulation.has(l.userId))
        .length,
    },
    helpingSkillsTrend,
    cutNoiseSd: noise === null ? null : round3(noise),
  };
}

/* -------------------------------------------------------------------------- */
/* EFF-03 · Effectiveness by segment                                          */
/* -------------------------------------------------------------------------- */

export const SEGMENT_DIMENSIONS = [
  'language',
  'workerType',
  'orgSize',
  'course',
  'difficulty',
  'difficultyTransition',
] as const;
export type SegmentDimension = (typeof SEGMENT_DIMENSIONS)[number];

/** Learners per org, banded. Bounds inclusive; `max: null` is open-ended. */
export const ORG_SIZE_BANDS = [
  { key: '1-9', label: '1–9 measured learners', min: 1, max: 9 },
  { key: '10-49', label: '10–49 measured learners', min: 10, max: 49 },
  { key: '50+', label: '50+ measured learners', min: 50, max: null },
] as const;

export const WORKER_TYPE_LABELS: Record<string, string> = {
  LAY: 'Lay worker',
  EARLY_PROFESSIONAL: 'Early professional',
  EXPERIENCED_PROFESSIONAL: 'Experienced professional',
  unset: 'Not set',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
  mixed: 'Mixed (no majority)',
  untagged: 'Untagged',
};

export const SEGMENT_FALLBACK_LABELS = {
  languageMixed: 'Mixed (no majority)',
  languageUnknown: 'Unknown language',
  orgUnknown: 'No org recorded',
  course: 'Started a course before “now”',
  freePractice: 'Free practice only',
} as const;

/** What the session lookup returns for one session id. */
export interface SessionSegmentAttributes {
  /** `languages.value` (stable locale code); null when unresolvable. */
  languageKey: string | null;
  /** `languages.label`, else its value. */
  languageLabel: string | null;
  /** Raw `scenarios."difficultyLevel"`; null when the scenario is gone. */
  difficulty: string | null;
}

export interface SegmentContext {
  sessions?: ReadonlyMap<string, SessionSegmentAttributes>;
  /** Raw `users.metadata->>'workerType'` per user (absent = never set). */
  workerTypes?: ReadonlyMap<number, string | null>;
  /** Earliest STARTED live enrollment per user. */
  courseStarts?: ReadonlyMap<number, Date>;
  /** Any tenant reference (uuid or code) → the tenant's uuid. */
  tenantAliases?: ReadonlyMap<string, string>;
}

/** {@link ChangeOut} of `computeProgress`, plus the averages either side. */
export interface SegmentChange {
  learners: number;
  earlyComposite: number | null;
  lateComposite: number | null;
  change: number | null;
  ci: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
}

export interface SegmentRow extends SegmentChange {
  key: string;
  label: string;
}

export interface SegmentComputation {
  dimension: SegmentDimension;
  cuts: number;
  windows: { early: number[]; late: number[]; from: 1 | 2 };
  cohortOptions: { cuts: number; learners: number }[];
  measuredLearners: number;
  panelLearners: number;
  overall: SegmentChange;
  segments: SegmentRow[];
  withheld: { key: string; label: string; learners: number }[];
}

/**
 * The paired start→now composite change over a set of learners, rounded and
 * floored EXACTLY as `computeProgress` floors `summary.composite` (AAQ-168):
 * change and CI 2 dp and null below the floor, sign-test p 3 dp, up/down/tied
 * always. `early[i]` and `late[i]` are learner i's window means, in panel
 * order (the bootstrap resamples by position).
 */
export function segmentChange(
  early: readonly number[],
  late: readonly number[],
  floor: number,
): SegmentChange {
  const pc = pairedChange(late.map((v, i) => v - early[i]));
  const shown = pc.n >= floor;
  const avg = (xs: readonly number[]) => {
    const m = mean(xs);
    return shown && m !== null ? round2(m) : null;
  };
  return {
    learners: pc.n,
    earlyComposite: avg(early),
    lateComposite: avg(late),
    change: shown && pc.meanChange !== null ? round2(pc.meanChange) : null,
    ci: shown && pc.ci ? [round2(pc.ci[0]), round2(pc.ci[1])] : null,
    up: pc.up,
    down: pc.down,
    tied: pc.tied,
    signP: pc.signP === null ? null : round3(pc.signP),
    detectable: shown && pc.detectable,
  };
}

/**
 * Majority vote. `winner` is null when there are no votes or when two values
 * tie for first (`tied` says which).
 */
function majority(votes: readonly string[]): {
  winner: string | null;
  tied: boolean;
} {
  if (votes.length === 0) return { winner: null, tied: false };
  const tally = new Map<string, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length > 1 && ranked[0][1] === ranked[1][1]
    ? { winner: null, tied: true }
    : { winner: ranked[0][0], tied: false };
}

/** Each distinct session across the given cuts, in consumption order. */
function sessionsOf(
  learner: EffectivenessLearner,
  cuts: readonly number[],
): string[] {
  const seen = new Set<string>();
  for (const k of cuts) {
    for (const id of learner.facts.get(k)?.sessionIds ?? []) seen.add(id);
  }
  return [...seen];
}

const DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD']);
const WORKER_TYPES = new Set([
  'LAY',
  'EARLY_PROFESSIONAL',
  'EXPERIENCED_PROFESSIONAL',
]);

/**
 * Majority normalised scenario difficulty over the sessions in `cuts`: one of
 * EASY / MEDIUM / HARD, "mixed" on a tie for first, "untagged" when no session
 * resolves to one (scenario gone, or a value outside the enum).
 */
function majorityDifficulty(
  learner: EffectivenessLearner,
  cuts: readonly number[],
  context: SegmentContext,
): string {
  const votes: string[] = [];
  for (const id of sessionsOf(learner, cuts)) {
    const raw = context.sessions?.get(id)?.difficulty;
    const v = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (DIFFICULTIES.has(v)) votes.push(v);
  }
  const { winner, tied } = majority(votes);
  return winner ?? (tied ? 'mixed' : 'untagged');
}

/** Learner org = canonical tenant of most of their panel cuts (tie → latest). */
function panelOrg(
  learner: EffectivenessLearner,
  panelCuts: readonly number[],
  canon: (ref: string | null) => string | null,
): string | null {
  const tenants = panelCuts
    .map((k) => canon(learner.facts.get(k)?.tenantId ?? null))
    .filter((t): t is string => t !== null);
  if (tenants.length === 0) return null;
  return majority(tenants).winner ?? tenants[tenants.length - 1];
}

/**
 * Which segment value one panel learner belongs to. Every learner gets
 * exactly one value — "mixed", "untagged", "unknown" and "not set" are values,
 * never a reason to drop someone — so the segments partition the panel.
 */
export function assignSegment(
  dimension: SegmentDimension,
  learner: EffectivenessLearner,
  ctx: {
    panelCuts: readonly number[];
    windows: { early: readonly number[]; late: readonly number[] };
    firstNowCut: number;
    context: SegmentContext;
    orgLearnerCounts: ReadonlyMap<string, number>;
    canon: (ref: string | null) => string | null;
  },
): { key: string; label: string } {
  const { panelCuts, firstNowCut, context } = ctx;
  switch (dimension) {
    case 'language': {
      const labels = new Map<string, string>();
      const votes: string[] = [];
      for (const id of sessionsOf(learner, panelCuts)) {
        const a = context.sessions?.get(id);
        if (!a?.languageKey) continue;
        votes.push(a.languageKey);
        labels.set(a.languageKey, a.languageLabel ?? a.languageKey);
      }
      const { winner, tied } = majority(votes);
      if (winner !== null) {
        return { key: winner, label: labels.get(winner) ?? winner };
      }
      return tied
        ? { key: 'mixed', label: SEGMENT_FALLBACK_LABELS.languageMixed }
        : { key: 'unknown', label: SEGMENT_FALLBACK_LABELS.languageUnknown };
    }
    case 'difficulty': {
      const key = majorityDifficulty(learner, panelCuts, context);
      return { key, label: DIFFICULTY_LABELS[key] };
    }
    case 'difficultyTransition': {
      const from = majorityDifficulty(learner, ctx.windows.early, context);
      const to = majorityDifficulty(learner, ctx.windows.late, context);
      return {
        key: `${from}→${to}`,
        label: `${DIFFICULTY_LABELS[from]} → ${DIFFICULTY_LABELS[to]}`,
      };
    }
    case 'workerType': {
      const raw = context.workerTypes?.get(learner.userId);
      const v = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
      const key = WORKER_TYPES.has(v) ? v : 'unset';
      return { key, label: WORKER_TYPE_LABELS[key] };
    }
    case 'orgSize': {
      const org = panelOrg(learner, panelCuts, ctx.canon);
      const size = org === null ? 0 : (ctx.orgLearnerCounts.get(org) ?? 0);
      const band = ORG_SIZE_BANDS.find(
        (b) => size >= b.min && (b.max === null || size <= b.max),
      );
      return band
        ? { key: band.key, label: band.label }
        : { key: 'unknown', label: SEGMENT_FALLBACK_LABELS.orgUnknown };
    }
    case 'course': {
      const started = context.courseStarts?.get(learner.userId);
      const closed = learner.facts.get(firstNowCut)?.closedAt;
      return started && closed && started.getTime() < closed.getTime()
        ? { key: 'course', label: SEGMENT_FALLBACK_LABELS.course }
        : { key: 'freePractice', label: SEGMENT_FALLBACK_LABELS.freePractice };
    }
  }
}

/**
 * Learners per org: distinct learners with at least one scored cut practised
 * there (any cut, not only panel cuts), keyed by canonical tenant id.
 */
export function orgLearnerCounts(
  learners: readonly EffectivenessLearner[],
  canon: (ref: string | null) => string | null,
): Map<string, number> {
  const members = new Map<string, Set<number>>();
  for (const l of learners) {
    for (const f of l.facts.values()) {
      const t = canon(f.tenantId);
      if (t === null) continue;
      let set = members.get(t);
      if (!set) {
        set = new Set();
        members.set(t, set);
      }
      set.add(l.userId);
    }
  }
  return new Map([...members.entries()].map(([t, s]) => [t, s.size]));
}

/** The Helping skills panel a segment split is taken over. */
export interface SegmentPanel {
  cuts: number;
  windows: { early: number[]; late: number[]; from: 1 | 2 };
  cohortOptions: { cuts: number; learners: number }[];
  /** Panel learners, in the order `computeProgress` holds them. */
  learners: EffectivenessLearner[];
  /** Every distinct session across the panel learners' cuts 1..N. */
  sessionIds: string[];
}

/**
 * The panel, its size N and its windows — taken from `computeProgress` for the
 * same request rather than re-derived from its rules, so the panel cannot
 * drift from AAQ-168's. Resolved before the segment lookups run because the
 * language and difficulty lookups need the panel's sessions.
 */
export function resolveSegmentPanel(
  learners: readonly EffectivenessLearner[],
  opts: {
    requestedCuts?: number;
    baselineFrom?: 1 | 2;
    sampleFloor: number;
    minCohort: number;
  },
): SegmentPanel {
  const progress = computeProgress(learners, {
    requestedCuts: opts.requestedCuts,
    baselineFrom: opts.baselineFrom ?? 1,
    sampleFloor: opts.sampleFloor,
    minCohort: opts.minCohort,
  });
  const n = progress.cuts;
  const panel = learners.filter((l) => hasCompleteRun(l, n));
  const panelCuts = Array.from({ length: n }, (_, i) => i + 1);
  const ids = new Set<string>();
  for (const l of panel) {
    for (const id of sessionsOf(l, panelCuts)) ids.add(id);
  }
  return {
    cuts: n,
    windows: progress.windows,
    cohortOptions: progress.cohortOptions,
    learners: panel,
    sessionIds: [...ids],
  };
}

/**
 * The Helping skills panel, split by one dimension.
 *
 * Each panel learner's own change (now-window mean composite − start-window
 * mean composite) is computed once, exactly as `computeProgress` computes it;
 * the overall row is {@link segmentChange} over every panel learner (AAQ-168's
 * number) and each segment's is over its members, in panel order. A segment
 * below `sampleFloor` learners moves to `withheld` with its count only.
 *
 * `allLearners` (everyone measured, not just the panel) sizes the orgs.
 */
export function buildSegments(
  allLearners: readonly EffectivenessLearner[],
  panel: SegmentPanel,
  opts: {
    dimension: SegmentDimension;
    sampleFloor: number;
    context: SegmentContext;
  },
): SegmentComputation {
  const n = panel.cuts;
  const { early, late } = panel.windows;
  const panelCuts = Array.from({ length: n }, (_, i) => i + 1);

  const windowMean = (l: EffectivenessLearner, ks: readonly number[]) => {
    const set = new Set(ks);
    return mean(l.cuts.filter((c) => set.has(c.cut)).map((c) => c.score));
  };
  const aliases = opts.context.tenantAliases;
  const canon = (ref: string | null): string | null =>
    ref === null ? null : (aliases?.get(ref) ?? ref);
  const counts = orgLearnerCounts(allLearners, canon);

  const groups = new Map<
    string,
    { label: string; early: number[]; late: number[] }
  >();
  const allEarly: number[] = [];
  const allLate: number[] = [];
  for (const l of panel.learners) {
    const e = windowMean(l, early) as number;
    const la = windowMean(l, late) as number;
    allEarly.push(e);
    allLate.push(la);
    const seg = assignSegment(opts.dimension, l, {
      panelCuts,
      windows: panel.windows,
      firstNowCut: late[0],
      context: opts.context,
      orgLearnerCounts: counts,
      canon,
    });
    let g = groups.get(seg.key);
    if (!g) {
      g = { label: seg.label, early: [], late: [] };
      groups.set(seg.key, g);
    }
    g.early.push(e);
    g.late.push(la);
  }

  const rows = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      ...segmentChange(g.early, g.late, opts.sampleFloor),
    }))
    .sort((a, b) => b.learners - a.learners || a.key.localeCompare(b.key));

  return {
    dimension: opts.dimension,
    cuts: n,
    windows: panel.windows,
    cohortOptions: panel.cohortOptions,
    measuredLearners: allLearners.length,
    panelLearners: panel.learners.length,
    overall: segmentChange(allEarly, allLate, opts.sampleFloor),
    segments: rows.filter((r) => r.learners >= opts.sampleFloor),
    withheld: rows
      .filter((r) => r.learners < opts.sampleFloor)
      .map((r) => ({ key: r.key, label: r.label, learners: r.learners })),
  };
}
