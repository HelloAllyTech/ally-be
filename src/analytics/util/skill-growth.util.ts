import type { FoundationalSkillsLearnerCutRow } from '../repository/foundational-skills-analytics.repository';
import {
  FHS_PROGRESS_THRESHOLDS,
  LearnerTrend,
  ProgressCut,
  ProgressLearner,
  learnerBand,
  learnerTrend,
} from './foundational-skills-progress.util';

/**
 * The arithmetic behind Highlights → Skill growth (AAQ-042..047, 049), on the
 * learner ruler R1: the foundational helping skills measure.
 *
 * Until 2026-10 this sub-tab plotted `scenario_session_details."compositeScore"`
 * — the LLM judge's score of the AI ACTOR's performance (ally-ai-learn's
 * evaluator prompt says "do NOT score the trainee") — indexed by the learner's
 * Nth session. It now reads the learner's own speech: every learner's
 * completed roleplay practice is cut into fixed 5,000-character slices of
 * what THEY said, and each slice ("cut") is scored 1–4 against one fixed rubric
 * (`src/foundational-skills`). The scored-cut definition is
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` and nothing here
 * redefines it: rubric pinned to `FHS_RUBRIC_VERSION`, status SCORED, composite
 * not null, test organisations excluded, org filter on the cut's own tenant.
 *
 * Pure functions over those cuts, so the floors, the ordinal axis and the
 * trend classification are tested without a database. Two decisions this
 * file makes, both matching the Helping skills sub-tab so the two tabs can
 * never disagree about the same learner:
 *
 *  - **The ordinal is the cut index.** Cut N is the learner's Nth 5,000
 *    characters of practice, the same amount of practice for everyone. A
 *    FAILED (or not-yet-scored) cut leaves a gap: that learner is simply
 *    absent at that ordinal and present again at the next scored one. Using
 *    "the Nth SCORED cut" instead would make ordinal 3 mean different amounts
 *    of practice for different people — the exact distortion the ordinal axis
 *    exists to remove — and would put the two tabs' x-axes out of step.
 *  - **The trend is `learnerTrend`'s, verbatim.** First half of ALL a
 *    learner's scored cuts against the last half, against a band sized to the
 *    measured slice-to-slice noise (`cutNoiseSd` over the same population),
 *    classified only from `FHS_PROGRESS_THRESHOLDS.trendMinCuts` cuts. Its four
 *    classes are renamed onto this endpoint's existing wire names (see
 *    {@link SKILL_TREND_CLASS_BY_LEARNER_TREND}); the classification itself is
 *    not re-implemented.
 */

/**
 * How far along a learner's practice history the curve is drawn (cut index).
 *
 * Twelve because that is where the sample runs out: the population thins with
 * every cut, so beyond about a dozen every cell is a handful of enthusiasts and
 * the "curve" is their personal noise plotted as a platform trend. The full
 * axis is returned to this bound with counts attached, so where the line stops
 * being credible is visible on the card rather than hidden in a query.
 */
export const SKILL_GROWTH_MAX_ORDINAL = 12;

/**
 * Scored cuts a learner needs before their whole history counts towards the
 * "experienced" series — the survivorship control.
 *
 * Ordinal 1 is every learner who ever completed a slice; ordinal 8 is only the
 * learners who kept going, and the ones who kept going are disproportionately
 * the ones doing well. The "experienced" series holds the population fixed:
 * only learners with at least this many SCORED cuts in scope, from their first
 * cut onwards. If both lines rise, the improvement survives the composition
 * change; if only the "all" line rises, what is being measured is attrition.
 *
 * Six because it is the smallest panel that still leaves a visible slope to
 * compare (three cuts barely move) while keeping enough learners to clear
 * `MIN_SCORE_SAMPLE_SIZE` at the later ordinals. Counted in scored cuts, so a
 * learner with a failed cut needs a seventh slice to qualify.
 */
export const SKILL_GROWTH_EXPERIENCED_MIN_CUTS = 6;

/**
 * Hard cap on cuts (and, separately, knowledge attempts) one learner's
 * drill-down returns. A runaway guard, not a page: nobody has hundreds of
 * scored cuts today. When it is hit the response says `truncated: true`
 * rather than passing a partial timeline off as complete.
 */
export const SKILL_GROWTH_LEARNER_ROW_CAP = 500;

/** How a learner's history moved. `insufficient` = too few scored cuts to say. */
export type SkillTrendClass =
  | 'improving'
  | 'flat'
  | 'declining'
  | 'insufficient';

/**
 * `learnerTrend`'s classes on this endpoint's wire names. The names predate
 * the re-pointing and a released admin build reads them, so the CLASS is the
 * Helping skills tab's and only the label is kept.
 */
export const SKILL_TREND_CLASS_BY_LEARNER_TREND: Readonly<
  Record<LearnerTrend, SkillTrendClass>
> = {
  improving: 'improving',
  steady: 'flat',
  declining: 'declining',
  tooEarly: 'insufficient',
};

/** Sort keys the learner list accepts — a closed set. */
export const SKILL_TREND_SORT_KEYS = [
  'delta',
  'evaluatedSessions',
  'lastSessionAt',
] as const;
export type SkillTrendSortKey = (typeof SKILL_TREND_SORT_KEYS)[number];

/** One scored cut, with the two fields the curve and the drill-down add. */
export interface SkillGrowthCut extends ProgressCut {
  /** When the session the cut closed in ended — the cut's place in time. */
  closedAt: Date;
  /** Every session the cut touches, in consumption order. */
  sessionIds: string[];
}

/** One learner's scored cuts, ascending by cut index. */
export interface SkillGrowthLearner extends ProgressLearner {
  cuts: SkillGrowthCut[];
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Rows arrive ordered by user then cut; fold them into one series per learner.
 *
 * The same fold `FoundationalSkillsAnalyticsService` applies before
 * `computeProgress`, carrying two more fields (`closedAt`, `sessionIds`). The
 * Helping skills tab's copy is module-private, which is why it is restated
 * rather than imported; the inputs and the `ProgressLearner` shape are shared,
 * so `cutNoiseSd`/`learnerTrend` see exactly what that tab feeds them.
 */
export function toSkillGrowthLearners(
  rows: readonly FoundationalSkillsLearnerCutRow[],
): SkillGrowthLearner[] {
  const byUser = new Map<number, SkillGrowthLearner>();
  for (const row of rows) {
    let learner = byUser.get(row.userId);
    if (!learner) {
      learner = {
        userId: row.userId,
        name: row.name,
        tenantId: row.tenantId,
        cuts: [],
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
      closedAt: row.closedAt,
      sessionIds: row.sessionIds,
    });
  }
  for (const learner of byUser.values()) {
    learner.cuts.sort((a, b) => a.cut - b.cut);
  }
  return [...byUser.values()];
}

/* -------------------------------------------------------------------------- */
/* The curve                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Postgres `percentile_cont` (linear interpolation between order statistics)
 * over an ASCENDING array; null for an empty one. Kept identical to the SQL
 * this replaced so a median does not move just because it moved into code.
 */
export function percentileCont(
  sorted: readonly number[],
  fraction: number,
): number | null {
  if (sorted.length === 0) return null;
  const pos = fraction * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface SkillGrowthCell {
  /** Median composite (1–4, 2dp); null below the floor. */
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Scored cuts at this ordinal — one per learner. Always present. */
  n: number;
}

export interface SkillGrowthOrdinal {
  ordinal: number;
  all: SkillGrowthCell;
  experienced: SkillGrowthCell;
}

export interface SkillGrowthCurve {
  /** 1..{@link SKILL_GROWTH_MAX_ORDINAL}, contiguous. */
  ordinals: SkillGrowthOrdinal[];
  learners: number;
  experiencedLearners: number;
  /** Scored cuts across every learner, including beyond the max ordinal. */
  scoredCuts: number;
  firstOrdinalMedian: number | null;
  lastComparableOrdinal: number | null;
  lastComparableMedian: number | null;
}

/**
 * Median and IQR of the composite at each cut index, for everyone and for the
 * experienced panel, floored at `sampleFloor` with `n` always travelling.
 *
 * Each cell holds at most one cut per learner (cut indexes are unique per
 * learner), so `n` counts observations AND people: no learner can weigh more
 * than once in a cell. Both series come from one pass over one set of cuts;
 * `experienced` is a property of the PERSON (their total scored cuts), never
 * of the row, so a novice's 6th cut cannot sneak into a panel their 1st is
 * kept out of.
 */
export function buildSkillGrowthCurve(
  learners: readonly SkillGrowthLearner[],
  sampleFloor: number,
): SkillGrowthCurve {
  const experienced = new Set(
    learners
      .filter((l) => l.cuts.length >= SKILL_GROWTH_EXPERIENCED_MIN_CUTS)
      .map((l) => l.userId),
  );
  const cell = (scores: number[]): SkillGrowthCell => {
    const n = scores.length;
    if (n < sampleFloor || n === 0) {
      return { median: null, p25: null, p75: null, n };
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const at = (p: number) => round2(percentileCont(sorted, p) as number);
    return { median: at(0.5), p25: at(0.25), p75: at(0.75), n };
  };

  const ordinals: SkillGrowthOrdinal[] = [];
  for (let ordinal = 1; ordinal <= SKILL_GROWTH_MAX_ORDINAL; ordinal += 1) {
    const all: number[] = [];
    const exp: number[] = [];
    for (const l of learners) {
      const c = l.cuts.find((x) => x.cut === ordinal);
      if (!c) continue;
      all.push(c.score);
      if (experienced.has(l.userId)) exp.push(c.score);
    }
    ordinals.push({ ordinal, all: cell(all), experienced: cell(exp) });
  }

  // Read off the floored cells so the headline and the chart can never
  // disagree about where the credible part of the line ends.
  const comparable = ordinals.filter((o) => o.all.median !== null);
  const last = comparable.length ? comparable[comparable.length - 1] : null;

  return {
    ordinals,
    learners: learners.filter((l) => l.cuts.length > 0).length,
    experiencedLearners: experienced.size,
    scoredCuts: learners.reduce((a, l) => a + l.cuts.length, 0),
    firstOrdinalMedian: ordinals[0]?.all.median ?? null,
    lastComparableOrdinal: last?.ordinal ?? null,
    lastComparableMedian: last?.all.median ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Own-baseline trend                                                         */
/* -------------------------------------------------------------------------- */

export interface SkillGrowthClassification {
  /** Scored cuts in scope. */
  scoredCuts: number;
  /** Mean composite of the first ⌊k/2⌋ scored cuts; null when insufficient. */
  firstWindowMean: number | null;
  /** Mean composite of the last ⌊k/2⌋ scored cuts; null when insufficient. */
  lastWindowMean: number | null;
  /** `learnerTrend`'s change (last half − first half); null when insufficient. */
  delta: number | null;
  /** ± band this learner's change had to clear; null when insufficient. */
  band: number | null;
  trend: SkillTrendClass;
  /** `closedAt` of the cut that made them classifiable; null when insufficient. */
  classifiedAt: Date | null;
  /** `closedAt` of their latest scored cut; null with no cuts. */
  lastCutAt: Date | null;
}

/**
 * One learner, classified exactly as the Helping skills tab classifies them:
 * `learnerTrend(learner, noise)` with `noise = cutNoiseSd(<the same
 * population>)`. Window means and delta are withheld for `insufficient`
 * learners so no surface prints a "change" the classifier refused to read.
 */
export function classifySkillGrowthLearner(
  learner: SkillGrowthLearner,
  noise: number | null,
): SkillGrowthClassification {
  const k = learner.cuts.length;
  const lastCutAt = k ? learner.cuts[k - 1].closedAt : null;
  const result = learnerTrend(learner, noise);
  const trend = SKILL_TREND_CLASS_BY_LEARNER_TREND[result.trend];
  if (trend === 'insufficient' || result.change === null) {
    return {
      scoredCuts: k,
      firstWindowMean: null,
      lastWindowMean: null,
      delta: null,
      band: null,
      trend: 'insufficient',
      classifiedAt: null,
      lastCutAt,
    };
  }
  // The same halves `learnerTrend` compared, restated only to SHOW them.
  const w = Math.floor(k / 2);
  const scores = learner.cuts.map((c) => c.score);
  return {
    scoredCuts: k,
    firstWindowMean: round2(mean(scores.slice(0, w))),
    lastWindowMean: round2(mean(scores.slice(k - w))),
    delta: round2(result.change),
    band: result.band === null ? null : round2(result.band),
    trend,
    classifiedAt:
      learner.cuts[FHS_PROGRESS_THRESHOLDS.trendMinCuts - 1]?.closedAt ?? null,
    lastCutAt,
  };
}

export interface SkillTrendMixMonth {
  month: string;
  improving: number;
  flat: number;
  declining: number;
}

export interface SkillTrendMix {
  classifiedLearners: number;
  insufficientLearners: number;
  improving: number;
  flat: number;
  declining: number;
  months: SkillTrendMixMonth[];
}

/** 'YYYY-MM' in UTC. */
const monthOf = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Improving / flat / declining, every learner against their own start.
 *
 * Months bucket learners by when they became CLASSIFIABLE — the
 * `closedSessionEndedAt` of their `trendMinCuts`th scored cut — so each
 * classified learner sits in exactly one bar and the bars sum to the
 * population. A learner's class is their class TODAY (over all their cuts);
 * the month only says when they first had enough history to have one.
 */
export function buildSkillTrendMix(
  classified: readonly SkillGrowthClassification[],
): SkillTrendMix {
  const months = new Map<string, SkillTrendMixMonth>();
  const mix: SkillTrendMix = {
    classifiedLearners: 0,
    insufficientLearners: 0,
    improving: 0,
    flat: 0,
    declining: 0,
    months: [],
  };
  for (const c of classified) {
    if (c.scoredCuts === 0) continue;
    if (c.trend === 'insufficient' || c.classifiedAt === null) {
      mix.insufficientLearners += 1;
      continue;
    }
    mix.classifiedLearners += 1;
    mix[c.trend] += 1;
    const key = monthOf(c.classifiedAt);
    const row = months.get(key) ?? {
      month: key,
      improving: 0,
      flat: 0,
      declining: 0,
    };
    row[c.trend] += 1;
    months.set(key, row);
  }
  mix.months = [...months.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  return mix;
}

export interface SkillTrendThresholds {
  minSessions: number;
  window: number;
  flatBand: number | null;
  cutNoiseSd: number | null;
  bandZ: number;
  bandRule: string;
}

/**
 * The knobs the classification turned on, echoed so no client keeps a copy.
 *
 * The old wire keys survive with honest values: `minSessions` is the scored
 * cuts needed (`trendMinCuts`), `window` the half-window AT that minimum
 * (⌊trendMinCuts/2⌋, the smallest window anyone is classified on), and
 * `flatBand` the band at that window — the WIDEST band any classified learner
 * faces. A learner with k cuts uses w = ⌊k/2⌋ and the narrower band in
 * `bandRule`; their own band travels on their row.
 */
export function skillTrendThresholds(
  noise: number | null,
): SkillTrendThresholds {
  const minSessions = FHS_PROGRESS_THRESHOLDS.trendMinCuts;
  const window = Math.floor(minSessions / 2);
  return {
    minSessions,
    window,
    flatBand: noise === null ? null : round2(learnerBand(noise, window)),
    cutNoiseSd: noise === null ? null : round3(noise),
    bandZ: FHS_PROGRESS_THRESHOLDS.learnerBandZ,
    bandRule:
      `k = the learner's scored cuts (at least ${minSessions}); w = floor(k / 2). ` +
      `Change = mean of the last w cuts − mean of the first w. Improving when ` +
      `change >= +band, declining when change <= −band, otherwise steady, where ` +
      `band = ${FHS_PROGRESS_THRESHOLDS.learnerBandZ} × cutNoiseSd × √(2 / w).`,
  };
}

/* -------------------------------------------------------------------------- */
/* The learner list                                                           */
/* -------------------------------------------------------------------------- */

export interface SkillGrowthLearnerSummary {
  learner: SkillGrowthLearner;
  classification: SkillGrowthClassification;
}

/**
 * Order the list the way the SQL it replaced did: the chosen key in the
 * chosen direction with NULLS LAST either way (so unclassified learners never
 * crowd the top of a "biggest movers" sort), learner id ascending as the
 * stable tiebreak so a page boundary never reshuffles between requests.
 */
export function sortSkillGrowthLearners(
  rows: readonly SkillGrowthLearnerSummary[],
  sort: SkillTrendSortKey,
  descending: boolean,
): SkillGrowthLearnerSummary[] {
  const keyOf = (r: SkillGrowthLearnerSummary): number | null => {
    if (sort === 'delta') return r.classification.delta;
    if (sort === 'evaluatedSessions') return r.classification.scoredCuts;
    return r.classification.lastCutAt?.getTime() ?? null;
  };
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka === null && kb !== null) return 1;
    if (kb === null && ka !== null) return -1;
    if (ka !== null && kb !== null && ka !== kb) {
      return descending ? kb - ka : ka - kb;
    }
    return a.learner.userId - b.learner.userId;
  });
}

/**
 * The scenario label for one cut: the distinct titles of the scenarios its
 * sessions ran, in consumption order, joined " · " — a cut can span several
 * scenarios, and naming only the first would hide exactly the mix a reader
 * needs to see a dip land on. Null when no session resolves to a titled
 * scenario.
 */
export function cutScenarioTitle(
  sessionIds: readonly string[],
  scenarios: ReadonlyMap<string, { scenarioTitle: string | null }>,
): string | null {
  const titles: string[] = [];
  for (const id of sessionIds) {
    const title = scenarios.get(id)?.scenarioTitle;
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles.length ? titles.join(' · ') : null;
}
