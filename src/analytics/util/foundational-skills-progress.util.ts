import {
  FHS_BEHAVIOURS_BY_CODE,
  FHS_RUBRIC,
  FhsTier,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  PairedChange,
  benjaminiHochberg,
  bootstrapMeanCi,
  minimumDetectableChange,
  pairedChange,
  sd,
  signTestP,
} from './paired-stats.util';

/**
 * The arithmetic behind the Highlights → Helping skills sub-tab: which
 * foundational helping skills and behaviours move with practice, for whom —
 * and, as importantly, how big a move has to be before this measure can see it.
 *
 * Pure functions over scored cuts, so every rule is unit-tested without a
 * database. The ideas that carry it:
 *
 *  - **A balanced panel.** Every "by cut" and "start vs now" number is taken
 *    over ONE fixed group: the learners whose first N cuts are all scored, so a
 *    change cannot come from who stopped practising.
 *  - **Windows, not single cuts.** "Start" and "now" average ⌊N/2⌋ cuts each.
 *    Cut 1 can be left out of the start window (`baselineFrom: 2`): on
 *    production data it behaves like a warm-up (feedback-seeking and unhelpful
 *    behaviour both step once between cut 1 and cut 2, then plateau), so a
 *    baseline anchored on it measures the warm-up, not learning.
 *  - **Uncertainty on every change.** A paired bootstrap CI and a sign test
 *    ride with each start→now number; only a CI that excludes zero is called
 *    a move. Behaviour moves are additionally corrected for the ~100 tests the
 *    chart runs at once (Benjamini–Hochberg).
 *  - **Noise-sized bands for people.** A learner's change is compared with the
 *    slice-to-slice noise estimated from the data itself, not a fixed band —
 *    at 0.20 SD per cut, a fixed ±0.15 band labelled ~10 of 24 learners as
 *    movers by chance alone.
 *  - **Opportunity-aware, and honest about what can't move.** A skill absent
 *    from a cut had no opportunity there — never a low score. Skills almost
 *    never assessable, or pinned at one level by the rubric, are labelled
 *    "not measurable" instead of being shown as "no change".
 */

export interface StoredVerdictLite {
  skill: string;
  level?: number | null;
  observed?: string[];
  notApplicable?: string[];
}

export interface ProgressCut {
  cut: number;
  score: number;
  unhelpful: boolean | null;
  levels: Record<string, number>;
  observed: ReadonlySet<string>;
}

export interface ProgressLearner {
  userId: number;
  name: string | null;
  tenantId: string | null;
  /** Ascending by cut, one entry per scored cut. */
  cuts: ProgressCut[];
}

/** Thresholds, served in the payload so no client keeps a drifting copy. */
export const FHS_PROGRESS_THRESHOLDS = {
  /** Cuts a learner needs before their own trend is classified (2 + 2). */
  trendMinCuts: 4,
  /** z for the noise-sized learner band (95%). */
  learnerBandZ: 1.96,
  /** Below this share of scored cuts, a skill is "rarely tested". */
  rareOpportunityPct: 25,
  /** At or above this share of assessments at ONE level, a skill is "capped". */
  cappedLevelShare: 0.95,
  /** A behaviour move counts as credible at or below this BH q-value. */
  behaviourQ: 0.05,
  /** Learner rows returned for the table, biggest own change first. */
  maxLearnerRows: 500,
} as const;

/** Practice-depth funnel steps (scored cuts). */
export const FHS_DEPTH_STEPS = [1, 2, 3, 5, 10] as const;

/** Unhelpful behaviours that are a safety matter rather than a style one. */
export const FHS_SAFETY_SKILLS = ['harm', 'confidentiality'] as const;

export const FHS_TIERS: readonly FhsTier[] = [
  'engage',
  'understand',
  'support',
];

export type LearnerTrend = 'improving' | 'steady' | 'declining' | 'tooEarly';
export type SkillMeasurability = 'measurable' | 'capped' | 'rare';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const roundCi = (
  ci: [number, number] | null,
  r: (v: number) => number = round2,
): [number, number] | null => (ci ? [r(ci[0]), r(ci[1])] : null);

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/**
 * Start and "now" windows over cuts `from..n`, each ⌊(n − from + 1)/2⌋ wide
 * and never overlapping. `from` falls back to 1 when the panel is too short to
 * leave cut 1 out (fewer than two cuts after it).
 */
export function windowsFor(
  n: number,
  from: 1 | 2 = 1,
): { early: number[]; late: number[]; from: 1 | 2 } {
  const start = from === 2 && n - 1 >= 2 ? 2 : 1;
  const w = Math.max(1, Math.floor((n - start + 1) / 2));
  return {
    early: range(start, start + w - 1),
    late: range(n - w + 1, n),
    from: start as 1 | 2,
  };
}

/** True when cuts 1..n are all scored for this learner. */
export function hasCompleteRun(learner: ProgressLearner, n: number): boolean {
  const have = new Set(learner.cuts.map((c) => c.cut));
  return range(1, n).every((k) => have.has(k));
}

/** Every panel size that holds at least `minCohort` learners, from 2 cuts up. */
export function cohortOptions(
  learners: readonly ProgressLearner[],
  minCohort: number,
): { cuts: number; learners: number }[] {
  const options: { cuts: number; learners: number }[] = [];
  for (let n = 2; ; n += 1) {
    const count = learners.filter((l) => hasCompleteRun(l, n)).length;
    if (count < minCohort) break;
    options.push({ cuts: n, learners: count });
  }
  return options;
}

/** Largest panel meeting the sample floor; else the largest offered; else 2. */
export function defaultCuts(
  options: readonly { cuts: number; learners: number }[],
  sampleFloor: number,
): number {
  const full = options.filter((o) => o.learners >= sampleFloor);
  if (full.length) return full[full.length - 1].cuts;
  if (options.length) return options[options.length - 1].cuts;
  return 2;
}

const cutsIn = (learner: ProgressLearner, ks: readonly number[]) => {
  const set = new Set(ks);
  return learner.cuts.filter((c) => set.has(c.cut));
};

/* -------------------------------------------------------------------------- */
/* Noise                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Slice-to-slice noise in the composite: the SD of differences between a
 * learner's consecutive cuts, over √2. Pooled across every learner. Real
 * learning between adjacent cuts is tiny next to it, so this is (slightly
 * over-) estimating pure measurement noise — the conservative direction.
 */
export function cutNoiseSd(
  learners: readonly ProgressLearner[],
): number | null {
  const diffs: number[] = [];
  for (const l of learners) {
    for (let i = 1; i < l.cuts.length; i += 1) {
      if (l.cuts[i].cut === l.cuts[i - 1].cut + 1) {
        diffs.push(l.cuts[i].score - l.cuts[i - 1].score);
      }
    }
  }
  const s = sd(diffs);
  return s === null ? null : s / Math.SQRT2;
}

/**
 * ICC(1): the share of composite variance that belongs to the LEARNER rather
 * than to the slice. Near zero means one cut says almost nothing about who
 * someone is. One-way random effects over learners with 2+ cuts.
 */
export function compositeIcc(
  learners: readonly ProgressLearner[],
): number | null {
  const groups = learners
    .map((l) => l.cuts.map((c) => c.score))
    .filter((g) => g.length >= 2);
  const g = groups.length;
  const N = groups.reduce((a, x) => a + x.length, 0);
  if (g < 2 || N <= g) return null;
  const grand = groups.flat().reduce((a, b) => a + b, 0) / N;
  const means = groups.map((x) => x.reduce((a, b) => a + b, 0) / x.length);
  const ssb = groups.reduce(
    (a, x, i) => a + x.length * (means[i] - grand) ** 2,
    0,
  );
  const ssw = groups.reduce(
    (a, x, i) => a + x.reduce((s, v) => s + (v - means[i]) ** 2, 0),
    0,
  );
  const msb = ssb / (g - 1);
  const msw = ssw / (N - g);
  const k0 = (N - groups.reduce((a, x) => a + x.length ** 2, 0) / N) / (g - 1);
  const denom = msb + (k0 - 1) * msw;
  if (denom <= 0) return null;
  return Math.max(0, (msb - msw) / denom);
}

/** 95% band for one learner's start→now change, windows of `w` cuts each. */
export const learnerBand = (noise: number, w: number): number =>
  FHS_PROGRESS_THRESHOLDS.learnerBandZ * noise * Math.sqrt(2 / Math.max(1, w));

/**
 * Own-trend class over ALL of a learner's scored cuts: first half vs last
 * half, against a band sized to the noise for that many cuts.
 */
export function learnerTrend(
  learner: ProgressLearner,
  noise: number | null,
): { trend: LearnerTrend; change: number | null; band: number | null } {
  const k = learner.cuts.length;
  if (k < 2) return { trend: 'tooEarly', change: null, band: null };
  const w = Math.floor(k / 2);
  const first = mean(learner.cuts.slice(0, w).map((c) => c.score)) as number;
  const last = mean(learner.cuts.slice(k - w).map((c) => c.score)) as number;
  const change = last - first;
  const band = noise === null ? null : learnerBand(noise, w);
  if (k < FHS_PROGRESS_THRESHOLDS.trendMinCuts || band === null) {
    return { trend: 'tooEarly', change, band };
  }
  const trend: LearnerTrend =
    change >= band ? 'improving' : change <= -band ? 'declining' : 'steady';
  return { trend, change, band };
}

/* -------------------------------------------------------------------------- */
/* Result shape                                                               */
/* -------------------------------------------------------------------------- */

export interface ChangeOut {
  n: number;
  change: number | null;
  ci: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
}

export interface CoachingFlag {
  code: string;
  skill: string;
  text: string;
  kind: 'safety' | 'repeat';
  cuts: number[];
  /** Seen in either of the learner's latest two cuts. */
  recent: boolean;
}

export interface ProgressComputation {
  cuts: number;
  cohortOptions: { cuts: number; learners: number }[];
  windows: { early: number[]; late: number[]; from: 1 | 2 };
  precision: {
    cutNoiseSd: number | null;
    icc: number | null;
    panelChangeSd: number | null;
    minimumDetectableChange: number | null;
    learnerBand: number | null;
    levelsChecked: number;
    levelCodeMismatches: number;
  };
  depth: { atLeast: number; learners: number }[];
  summary: {
    cohortLearners: number;
    earlyComposite: number | null;
    lateComposite: number | null;
    composite: ChangeOut;
    unhelpful: {
      earlyPct: number | null;
      latePct: number | null;
      changePts: number | null;
      ciPts: [number, number] | null;
      stopped: number;
      started: number;
      persisted: number;
      never: number;
      signP: number | null;
      detectable: boolean;
    };
    skills: {
      detectableUp: number;
      detectableDown: number;
      noDetectableChange: number;
      tooFewLearners: number;
      notMeasurable: number;
    };
  };
  byCut: {
    cut: number;
    learners: number;
    composite: number | null;
    compositeCi: [number, number] | null;
    unhelpfulPct: number | null;
    unhelpfulCi: [number, number] | null;
    tiers: { tier: FhsTier; learners: number; avgLevel: number | null }[];
    skills: { skill: string; learners: number; avgLevel: number | null }[];
  }[];
  tiers: ({ tier: FhsTier } & ChangeOut & {
      earlyAvg: number | null;
      lateAvg: number | null;
    })[];
  skills: ({
    skill: string;
    name: string;
    tier: FhsTier;
    measurability: SkillMeasurability;
    earlyAvg: number | null;
    lateAvg: number | null;
    levelMix: {
      early: { assessments: number; levels: number[] | null };
      late: { assessments: number; levels: number[] | null };
    };
    opportunityCuts: number;
    opportunityPct: number | null;
    learnersWithOpportunity: number;
    learnersWithTwoPlus: number;
  } & ChangeOut)[];
  behaviours: {
    code: string;
    skill: string;
    kind: 'unhelpful' | 'basic' | 'advanced';
    text: string;
    pairedLearners: number;
    earlyPct: number | null;
    latePct: number | null;
    changePts: number | null;
    gained: number;
    lost: number;
    signP: number | null;
    q: number | null;
    credible: boolean;
    firstSliceLearners: number;
    firstSlicePct: number | null;
    everLearners: number;
    everPct: number | null;
  }[];
  safety: {
    selfHarm: {
      learnersWithCue: number;
      cutsWithCue: number;
      cutsFollowedUp: number;
      cutsMissed: number;
      cutsAmbiguous: number;
      cutsWithAdvanced: number;
      cutsWithOtherUnhelpful: number;
      learnersFollowedFirst: number;
      learnersMissedFirst: number;
      learnersAmbiguousFirst: number;
      repeatLearners: number;
      repeatBetter: number;
      repeatWorse: number;
      repeatSame: number;
    };
    confidentiality: {
      learnersAssessable: number;
      cutsAssessable: number;
      learnersWithTwoPlus: number;
      learnersExplained: number;
      learnersListedExceptions: number;
      learnersExplainedWhy: number;
      learnersPromisedAbsolute: number;
      learnersInaccurate: number;
    };
  };
  trend: {
    improving: number;
    steady: number;
    declining: number;
    tooEarly: number;
  };
  learners: {
    id: number;
    name: string | null;
    tenantId: string | null;
    cutsReached: number;
    earlyComposite: number;
    lateComposite: number;
    change: number;
    /** ± band this learner's change must clear to be more than noise. */
    band: number | null;
    beyondNoise: 'up' | 'down' | null;
    unhelpfulEarly: boolean;
    unhelpfulLate: boolean;
    flags: CoachingFlag[];
  }[];
  learnersTruncated: boolean;
}

const changeOut = (
  pc: PairedChange,
  floor: number,
  r: (v: number) => number = round2,
): ChangeOut => {
  const shown = pc.n >= floor;
  return {
    n: pc.n,
    change: shown && pc.meanChange !== null ? r(pc.meanChange) : null,
    ci: shown ? roundCi(pc.ci, r) : null,
    up: pc.up,
    down: pc.down,
    tied: pc.tied,
    signP: pc.signP === null ? null : round3(pc.signP),
    detectable: shown && pc.detectable,
  };
};

/**
 * Everything the sub-tab draws, for a panel of the first `requestedCuts` cuts
 * (or the default panel when omitted or not on offer).
 */
export function computeProgress(
  learners: readonly ProgressLearner[],
  opts: {
    requestedCuts?: number;
    baselineFrom?: 1 | 2;
    sampleFloor: number;
    minCohort: number;
    levelChecks?: { checked: number; mismatched: number };
  },
): ProgressComputation {
  const T = FHS_PROGRESS_THRESHOLDS;
  const floor = opts.sampleFloor;
  const floorAvg = (n: number, v: number | null) =>
    v !== null && n >= floor ? round2(v) : null;
  const floorPct = (n: number, share: number | null) =>
    share !== null && n >= floor ? round1(share * 100) : null;

  const options = cohortOptions(learners, opts.minCohort);
  const n = options.some((o) => o.cuts === opts.requestedCuts)
    ? (opts.requestedCuts as number)
    : defaultCuts(options, floor);
  const windows = windowsFor(n, opts.baselineFrom ?? 1);
  const { early, late } = windows;
  const cohort = learners.filter((l) => hasCompleteRun(l, n));
  const anyUnhelpful = (l: ProgressLearner, ks: readonly number[]) =>
    cutsIn(l, ks).some((c) => c.unhelpful === true);
  const allCuts = learners.flatMap((l) => l.cuts);

  // ── Noise ─────────────────────────────────────────────────────────────────
  const noise = cutNoiseSd(learners);
  const band = noise === null ? null : learnerBand(noise, early.length);

  // ── Per skill ─────────────────────────────────────────────────────────────
  const skills = FHS_RUBRIC.map((s) => {
    const assessed = allCuts
      .map((c) => c.levels[s.key])
      .filter((v): v is number => typeof v === 'number');
    const opportunityPct = allCuts.length
      ? (assessed.length / allCuts.length) * 100
      : null;
    const levelCounts = [1, 2, 3, 4].map(
      (lv) => assessed.filter((v) => v === lv).length,
    );
    const capped =
      assessed.length > 0 &&
      Math.max(...levelCounts) / assessed.length >= T.cappedLevelShare;
    const measurability: SkillMeasurability =
      opportunityPct !== null && opportunityPct < T.rareOpportunityPct
        ? 'rare'
        : capped
          ? 'capped'
          : 'measurable';

    const diffs: number[] = [];
    const earlyMeans: number[] = [];
    const lateMeans: number[] = [];
    for (const l of cohort) {
      const lv = (ks: readonly number[]) =>
        cutsIn(l, ks)
          .map((c) => c.levels[s.key])
          .filter((v): v is number => typeof v === 'number');
      const e = mean(lv(early));
      const la = mean(lv(late));
      if (e === null || la === null) continue;
      diffs.push(la - e);
      earlyMeans.push(e);
      lateMeans.push(la);
    }
    const mix = (ks: readonly number[]) => {
      const counts = [0, 0, 0, 0];
      let assessments = 0;
      for (const l of cohort) {
        for (const c of cutsIn(l, ks)) {
          const lv = c.levels[s.key];
          if (typeof lv === 'number' && lv >= 1 && lv <= 4) {
            counts[lv - 1] += 1;
            assessments += 1;
          }
        }
      }
      return { assessments, levels: assessments >= floor ? counts : null };
    };
    const perLearnerOpp = learners.map(
      (l) => l.cuts.filter((c) => typeof c.levels[s.key] === 'number').length,
    );
    const pc = changeOut(pairedChange(diffs), floor);
    return {
      skill: s.key,
      name: s.name,
      tier: s.tier,
      measurability,
      earlyAvg: floorAvg(diffs.length, mean(earlyMeans)),
      lateAvg: floorAvg(diffs.length, mean(lateMeans)),
      ...pc,
      // A move on a skill the measure can't move is not a move.
      detectable: pc.detectable && measurability === 'measurable',
      levelMix: { early: mix(early), late: mix(late) },
      opportunityCuts: assessed.length,
      opportunityPct: opportunityPct === null ? null : round1(opportunityPct),
      learnersWithOpportunity: perLearnerOpp.filter((k) => k >= 1).length,
      learnersWithTwoPlus: perLearnerOpp.filter((k) => k >= 2).length,
    };
  });

  // ── Per tier, start → now, paired ─────────────────────────────────────────
  const tierMean = (c: ProgressCut, tier: FhsTier) =>
    mean(
      FHS_RUBRIC.filter((s) => s.tier === tier)
        .map((s) => c.levels[s.key])
        .filter((v): v is number => typeof v === 'number'),
    );
  const tiers = FHS_TIERS.map((tier) => {
    const diffs: number[] = [];
    const e: number[] = [];
    const la: number[] = [];
    for (const l of cohort) {
      const w = (ks: readonly number[]) =>
        mean(
          cutsIn(l, ks)
            .map((c) => tierMean(c, tier))
            .filter((v): v is number => v !== null),
        );
      const a = w(early);
      const b = w(late);
      if (a === null || b === null) continue;
      diffs.push(b - a);
      e.push(a);
      la.push(b);
    }
    return {
      tier,
      earlyAvg: floorAvg(diffs.length, mean(e)),
      lateAvg: floorAvg(diffs.length, mean(la)),
      ...changeOut(pairedChange(diffs), floor),
    };
  });

  // ── Per cut, over the same panel ──────────────────────────────────────────
  const byCut = range(1, n).map((k) => {
    const at = cohort
      .map((l) => l.cuts.find((c) => c.cut === k))
      .filter((c): c is ProgressCut => !!c);
    const flagged = at.filter((c) => c.unhelpful !== null);
    const scores = at.map((c) => c.score);
    const unh = flagged.map((c) => (c.unhelpful ? 100 : 0));
    return {
      cut: k,
      learners: at.length,
      composite: floorAvg(at.length, mean(scores)),
      compositeCi: at.length >= floor ? roundCi(bootstrapMeanCi(scores)) : null,
      unhelpfulPct: floorPct(
        flagged.length,
        flagged.length
          ? flagged.filter((c) => c.unhelpful).length / flagged.length
          : null,
      ),
      unhelpfulCi:
        flagged.length >= floor ? roundCi(bootstrapMeanCi(unh), round1) : null,
      tiers: FHS_TIERS.map((tier) => {
        const perLearner = at
          .map((c) => tierMean(c, tier))
          .filter((v): v is number => v !== null);
        return {
          tier,
          learners: perLearner.length,
          avgLevel: floorAvg(perLearner.length, mean(perLearner)),
        };
      }),
      skills: FHS_RUBRIC.map((s) => {
        const lv = at
          .map((c) => c.levels[s.key])
          .filter((v): v is number => typeof v === 'number');
        return {
          skill: s.key,
          learners: lv.length,
          avgLevel: floorAvg(lv.length, mean(lv)),
        };
      }),
    };
  });

  // ── Per behaviour: paired move (BH-corrected) + profile over everyone ─────
  const rawBehaviours = [...FHS_BEHAVIOURS_BY_CODE.values()].map((b) => {
    let paired = 0;
    let earlyShows = 0;
    let lateShows = 0;
    let gained = 0;
    let lost = 0;
    for (const l of cohort) {
      const assessable = (ks: readonly number[]) =>
        cutsIn(l, ks).filter((c) => typeof c.levels[b.skill] === 'number');
      const e = assessable(early);
      const la = assessable(late);
      if (!e.length || !la.length) continue;
      paired += 1;
      const es = e.some((c) => c.observed.has(b.code));
      const ls = la.some((c) => c.observed.has(b.code));
      if (es) earlyShows += 1;
      if (ls) lateShows += 1;
      if (!es && ls) gained += 1;
      if (es && !ls) lost += 1;
    }
    let firstN = 0;
    let firstShows = 0;
    let everN = 0;
    let everShows = 0;
    for (const l of learners) {
      const c1 = l.cuts.find((c) => c.cut === 1);
      if (c1 && typeof c1.levels[b.skill] === 'number') {
        firstN += 1;
        if (c1.observed.has(b.code)) firstShows += 1;
      }
      const assessable = l.cuts.filter(
        (c) => typeof c.levels[b.skill] === 'number',
      );
      if (assessable.length) {
        everN += 1;
        if (assessable.some((c) => c.observed.has(b.code))) everShows += 1;
      }
    }
    const earlyPct = floorPct(paired, paired ? earlyShows / paired : null);
    const latePct = floorPct(paired, paired ? lateShows / paired : null);
    return {
      code: b.code,
      skill: b.skill,
      kind: b.kind,
      text: b.text,
      pairedLearners: paired,
      earlyPct,
      latePct,
      changePts:
        earlyPct !== null && latePct !== null
          ? round1(latePct - earlyPct)
          : null,
      gained,
      lost,
      signP: paired >= floor ? signTestP(gained, lost) : null,
      firstSliceLearners: firstN,
      firstSlicePct: floorPct(firstN, firstN ? firstShows / firstN : null),
      everLearners: everN,
      everPct: floorPct(everN, everN ? everShows / everN : null),
    };
  });
  const qs = benjaminiHochberg(rawBehaviours.map((b) => b.signP));
  const behaviours = rawBehaviours.map((b, i) => ({
    ...b,
    signP: b.signP === null ? null : round3(b.signP),
    q: qs[i] === null ? null : round3(qs[i] as number),
    credible: qs[i] !== null && (qs[i] as number) <= T.behaviourQ,
  }));

  // ── Safety (everyone; descriptive counts, unaudited judge coding) ─────────
  const cueState = (c: ProgressCut): 'followed' | 'missed' | 'ambiguous' => {
    const missed = c.observed.has('harm.u1');
    const asked = c.observed.has('harm.b1') || c.observed.has('harm.b2');
    // Both coded (a cut spanning sessions can hold a miss and a follow-up) or
    // neither (the cut may end before the helper had room) is "unclear", never
    // silently counted as a miss.
    if (missed === asked) return 'ambiguous';
    return missed ? 'missed' : 'followed';
  };
  const selfHarm = {
    learnersWithCue: 0,
    cutsWithCue: 0,
    cutsFollowedUp: 0,
    cutsMissed: 0,
    cutsAmbiguous: 0,
    cutsWithAdvanced: 0,
    cutsWithOtherUnhelpful: 0,
    learnersFollowedFirst: 0,
    learnersMissedFirst: 0,
    learnersAmbiguousFirst: 0,
    repeatLearners: 0,
    repeatBetter: 0,
    repeatWorse: 0,
    repeatSame: 0,
  };
  const conf = {
    learnersAssessable: 0,
    cutsAssessable: 0,
    learnersWithTwoPlus: 0,
    learnersExplained: 0,
    learnersListedExceptions: 0,
    learnersExplainedWhy: 0,
    learnersPromisedAbsolute: 0,
    learnersInaccurate: 0,
  };
  for (const l of learners) {
    const cue = l.cuts.filter((c) => typeof c.levels.harm === 'number');
    if (cue.length) {
      selfHarm.learnersWithCue += 1;
      const states = cue.map(cueState);
      for (const [i, s] of states.entries()) {
        selfHarm.cutsWithCue += 1;
        if (s === 'followed') selfHarm.cutsFollowedUp += 1;
        else if (s === 'missed') selfHarm.cutsMissed += 1;
        else selfHarm.cutsAmbiguous += 1;
        if (cue[i].observed.has('harm.a1') || cue[i].observed.has('harm.a2')) {
          selfHarm.cutsWithAdvanced += 1;
        }
        if (
          ['harm.u2', 'harm.u3', 'harm.u4'].some((u) => cue[i].observed.has(u))
        ) {
          selfHarm.cutsWithOtherUnhelpful += 1;
        }
      }
      if (states[0] === 'followed') selfHarm.learnersFollowedFirst += 1;
      else if (states[0] === 'missed') selfHarm.learnersMissedFirst += 1;
      else selfHarm.learnersAmbiguousFirst += 1;
      const clear = states.filter((s) => s !== 'ambiguous');
      if (clear.length >= 2) {
        selfHarm.repeatLearners += 1;
        const first = clear[0] === 'followed' ? 1 : 0;
        const last = clear[clear.length - 1] === 'followed' ? 1 : 0;
        if (last > first) selfHarm.repeatBetter += 1;
        else if (last < first) selfHarm.repeatWorse += 1;
        else selfHarm.repeatSame += 1;
      }
    }
    const cc = l.cuts.filter(
      (c) => typeof c.levels.confidentiality === 'number',
    );
    if (cc.length) {
      conf.learnersAssessable += 1;
      conf.cutsAssessable += cc.length;
      if (cc.length >= 2) conf.learnersWithTwoPlus += 1;
      const ever = (code: string) => cc.some((c) => c.observed.has(code));
      if (ever('confidentiality.b1')) conf.learnersExplained += 1;
      if (ever('confidentiality.b2')) conf.learnersListedExceptions += 1;
      if (ever('confidentiality.b3')) conf.learnersExplainedWhy += 1;
      if (ever('confidentiality.u3')) conf.learnersPromisedAbsolute += 1;
      if (ever('confidentiality.u2')) conf.learnersInaccurate += 1;
    }
  }

  // ── Everyone, against their own start ─────────────────────────────────────
  const trends = new Map(
    learners.map((l) => [l.userId, learnerTrend(l, noise)]),
  );
  const trend = { improving: 0, steady: 0, declining: 0, tooEarly: 0 };
  for (const t of trends.values()) trend[t.trend] += 1;

  // ── The panel, one row per learner, with coaching flags ───────────────────
  const unhelpfulCodes = [...FHS_BEHAVIOURS_BY_CODE.values()].filter(
    (b) => b.kind === 'unhelpful',
  );
  const flagsFor = (l: ProgressLearner): CoachingFlag[] => {
    const recentCuts = new Set(l.cuts.slice(-2).map((c) => c.cut));
    const out: CoachingFlag[] = [];
    for (const b of unhelpfulCodes) {
      const cuts = l.cuts
        .filter((c) => c.observed.has(b.code))
        .map((c) => c.cut);
      const safety = (FHS_SAFETY_SKILLS as readonly string[]).includes(b.skill);
      if (cuts.length === 0 || (!safety && cuts.length < 2)) continue;
      out.push({
        code: b.code,
        skill: b.skill,
        text: b.text,
        kind: safety ? 'safety' : 'repeat',
        cuts,
        recent: cuts.some((k) => recentCuts.has(k)),
      });
    }
    return out.sort(
      (a, b) =>
        (a.kind === 'safety' ? 0 : 1) - (b.kind === 'safety' ? 0 : 1) ||
        b.cuts.length - a.cuts.length,
    );
  };
  const panelDiffs: number[] = [];
  const rows = cohort.map((l) => {
    const e = mean(cutsIn(l, early).map((c) => c.score)) as number;
    const la = mean(cutsIn(l, late).map((c) => c.score)) as number;
    const change = la - e;
    panelDiffs.push(change);
    return {
      id: l.userId,
      name: l.name,
      tenantId: l.tenantId,
      cutsReached: l.cuts[l.cuts.length - 1]?.cut ?? 0,
      earlyComposite: round2(e),
      lateComposite: round2(la),
      change: round2(change),
      band: band === null ? null : round2(band),
      beyondNoise:
        band === null
          ? null
          : change >= band
            ? ('up' as const)
            : change <= -band
              ? ('down' as const)
              : null,
      unhelpfulEarly: anyUnhelpful(l, early),
      unhelpfulLate: anyUnhelpful(l, late),
      flags: flagsFor(l),
    };
  });
  rows.sort((a, b) => b.change - a.change || a.id - b.id);

  // ── Headline ──────────────────────────────────────────────────────────────
  const earlyComposites = cohort.map(
    (l) => mean(cutsIn(l, early).map((c) => c.score)) as number,
  );
  const lateComposites = cohort.map(
    (l) => mean(cutsIn(l, late).map((c) => c.score)) as number,
  );
  const unhDiffs = cohort.map(
    (l) =>
      (anyUnhelpful(l, late) ? 100 : 0) - (anyUnhelpful(l, early) ? 100 : 0),
  );
  const transitions = { stopped: 0, started: 0, persisted: 0, never: 0 };
  for (const l of cohort) {
    const a = anyUnhelpful(l, early);
    const b = anyUnhelpful(l, late);
    if (a && !b) transitions.stopped += 1;
    else if (!a && b) transitions.started += 1;
    else if (a && b) transitions.persisted += 1;
    else transitions.never += 1;
  }
  const unhCi = bootstrapMeanCi(unhDiffs);
  const unhShown = cohort.length >= floor;
  const measurableSkills = skills.filter(
    (s) => s.measurability === 'measurable',
  );
  const panelSd = sd(panelDiffs);

  return {
    cuts: n,
    cohortOptions: options,
    windows,
    precision: {
      cutNoiseSd: noise === null ? null : round3(noise),
      icc: (() => {
        const v = compositeIcc(learners);
        return v === null ? null : round3(v);
      })(),
      panelChangeSd: panelSd === null ? null : round3(panelSd),
      minimumDetectableChange: (() => {
        const v =
          panelSd === null
            ? null
            : minimumDetectableChange(panelSd, cohort.length);
        return v === null ? null : round2(v);
      })(),
      learnerBand: band === null ? null : round2(band),
      levelsChecked: opts.levelChecks?.checked ?? 0,
      levelCodeMismatches: opts.levelChecks?.mismatched ?? 0,
    },
    depth: FHS_DEPTH_STEPS.map((k) => ({
      atLeast: k,
      learners: learners.filter((l) => l.cuts.length >= k).length,
    })),
    summary: {
      cohortLearners: cohort.length,
      earlyComposite: floorAvg(cohort.length, mean(earlyComposites)),
      lateComposite: floorAvg(cohort.length, mean(lateComposites)),
      composite: changeOut(
        pairedChange(lateComposites.map((v, i) => v - earlyComposites[i])),
        floor,
      ),
      unhelpful: {
        earlyPct: floorPct(
          cohort.length,
          cohort.length
            ? cohort.filter((l) => anyUnhelpful(l, early)).length /
                cohort.length
            : null,
        ),
        latePct: floorPct(
          cohort.length,
          cohort.length
            ? cohort.filter((l) => anyUnhelpful(l, late)).length / cohort.length
            : null,
        ),
        changePts:
          unhShown && unhDiffs.length ? round1(mean(unhDiffs) as number) : null,
        ciPts: unhShown ? roundCi(unhCi, round1) : null,
        ...transitions,
        signP: (() => {
          const p = signTestP(transitions.started, transitions.stopped);
          return p === null ? null : round3(p);
        })(),
        detectable: unhShown && !!unhCi && (unhCi[0] > 0 || unhCi[1] < 0),
      },
      skills: {
        detectableUp: measurableSkills.filter(
          (s) => s.detectable && (s.change ?? 0) > 0,
        ).length,
        detectableDown: measurableSkills.filter(
          (s) => s.detectable && (s.change ?? 0) < 0,
        ).length,
        noDetectableChange: measurableSkills.filter(
          (s) => s.change !== null && !s.detectable,
        ).length,
        tooFewLearners: measurableSkills.filter((s) => s.change === null)
          .length,
        notMeasurable: skills.length - measurableSkills.length,
      },
    },
    byCut,
    tiers,
    skills,
    behaviours,
    safety: { selfHarm, confidentiality: conf },
    trend,
    learners: rows.slice(0, T.maxLearnerRows),
    learnersTruncated: rows.length > T.maxLearnerRows,
  };
}

/**
 * How many stored skill levels disagree with the level the stored behaviour
 * codes imply. The judge only ticks codes and the level is derived in code,
 * so any mismatch is a pipeline bug worth surfacing, not a judgement call.
 */
export function countLevelMismatches(
  verdictsPerCut: readonly (readonly StoredVerdictLite[])[],
  derive: (
    skill: string,
    observed: Set<string>,
    notApplicable: Set<string>,
  ) => number | null,
): { checked: number; mismatched: number } {
  let checked = 0;
  let mismatched = 0;
  for (const verdicts of verdictsPerCut) {
    for (const v of verdicts) {
      if (typeof v.level !== 'number') continue;
      const expected = derive(
        v.skill,
        new Set(v.observed ?? []),
        new Set(v.notApplicable ?? []),
      );
      if (expected === null) continue;
      checked += 1;
      if (expected !== v.level) mismatched += 1;
    }
  }
  return { checked, mismatched };
}
