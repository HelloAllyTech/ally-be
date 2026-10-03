import {
  FHS_BEHAVIOURS_BY_CODE,
  FHS_RUBRIC,
  FhsTier,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';

/**
 * The arithmetic behind the Skills sub-tab: which foundational helping skills
 * and behaviours move with practice, and for whom.
 *
 * Pure functions over scored cuts, so every rule below is unit-tested without a
 * database. Three ideas carry the whole module:
 *
 *  - **A balanced panel.** Every "by cut" and "start vs now" number is taken
 *    over ONE fixed group: the learners whose first N cuts are all scored. Each
 *    cut then holds the same people, so a change cannot come from who stopped
 *    practising — the survivorship trap the AAQ-166 card needs a second line
 *    to control for.
 *  - **Windows, not single cuts.** "Start" is the mean of cuts 1..w and "now"
 *    the mean of cuts N−w+1..N, with w = ⌊N/2⌋. One judged slice is noisy; a
 *    window halves the weight of any single verdict and never overlaps itself.
 *  - **Opportunity-aware.** A skill missing from a cut's `skillLevels` had no
 *    opportunity there — not a low score — so it is skipped, never counted as
 *    a zero. A learner enters a skill's comparison only when the skill was
 *    assessable in both windows.
 */

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
  /** A learner's composite change within ±this is "holding steady". */
  compositeFlatBand: 0.15,
  /** A learner's change on one skill within ±this (levels) is "unchanged". */
  skillFlatBand: 0.5,
  /** A skill's paired average change beyond ±this counts as moving. */
  skillMoveBand: 0.1,
  /** Learner rows returned for the table, biggest own change first. */
  maxLearnerRows: 500,
} as const;

/** Practice-volume buckets for "does more practice mean more change". */
export const FHS_DOSE_BUCKETS: readonly {
  label: string;
  min: number;
  max: number | null;
}[] = [
  { label: '2–3 cuts', min: 2, max: 3 },
  { label: '4–5 cuts', min: 4, max: 5 },
  { label: '6–9 cuts', min: 6, max: 9 },
  { label: '10+ cuts', min: 10, max: null },
];

export const FHS_TIERS: readonly FhsTier[] = [
  'engage',
  'understand',
  'support',
];

export type LearnerTrend = 'improving' | 'steady' | 'declining' | 'tooEarly';

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round1 = (v: number): number => Math.round(v * 10) / 10;

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

const range = (from: number, to: number): number[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** Start and "now" windows over cuts 1..n. Only meaningful for n >= 2. */
export function windowsFor(n: number): { early: number[]; late: number[] } {
  const w = Math.max(1, Math.floor(n / 2));
  return { early: range(1, w), late: range(n - w + 1, n) };
}

/** True when cuts 1..n are all scored for this learner. */
export function hasCompleteRun(learner: ProgressLearner, n: number): boolean {
  const have = new Set(learner.cuts.map((c) => c.cut));
  return range(1, n).every((k) => have.has(k));
}

/**
 * Every panel size that holds at least `minCohort` learners, from 2 cuts up.
 * Monotone by construction: a complete run of N implies one of N−1.
 */
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

/**
 * The largest panel with enough learners to show averages; failing that the
 * largest panel at all; failing that 2, which renders as an honest empty state.
 */
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

/** Own-trend class over ALL of a learner's scored cuts: first half vs last half. */
export function learnerTrend(learner: ProgressLearner): {
  trend: LearnerTrend;
  change: number | null;
} {
  const k = learner.cuts.length;
  if (k < 2) return { trend: 'tooEarly', change: null };
  const w = Math.floor(k / 2);
  const first = mean(learner.cuts.slice(0, w).map((c) => c.score)) as number;
  const last = mean(learner.cuts.slice(k - w).map((c) => c.score)) as number;
  const change = last - first;
  if (k < FHS_PROGRESS_THRESHOLDS.trendMinCuts) {
    return { trend: 'tooEarly', change };
  }
  const band = FHS_PROGRESS_THRESHOLDS.compositeFlatBand;
  const trend: LearnerTrend =
    change >= band ? 'improving' : change <= -band ? 'declining' : 'steady';
  return { trend, change };
}

interface SkillWindowStat {
  early: number | null;
  late: number | null;
}

/** One learner's mean level on one skill in each window (null = not assessable). */
function skillWindows(
  learner: ProgressLearner,
  skill: string,
  early: readonly number[],
  late: readonly number[],
): SkillWindowStat {
  const levelsIn = (ks: readonly number[]) =>
    cutsIn(learner, ks)
      .map((c) => c.levels[skill])
      .filter((v): v is number => typeof v === 'number');
  return { early: mean(levelsIn(early)), late: mean(levelsIn(late)) };
}

export interface ProgressComputation {
  cuts: number;
  cohortOptions: { cuts: number; learners: number }[];
  windows: { early: number[]; late: number[] };
  summary: {
    cohortLearners: number;
    earlyComposite: number | null;
    lateComposite: number | null;
    compositeChange: number | null;
    unhelpfulEarlyPct: number | null;
    unhelpfulLatePct: number | null;
    skillsUp: number;
    skillsDown: number;
    skillsSteady: number;
    skillsWithheld: number;
  };
  byCut: {
    cut: number;
    learners: number;
    composite: number | null;
    unhelpfulPct: number | null;
    tiers: { tier: FhsTier; learners: number; avgLevel: number | null }[];
    skills: { skill: string; learners: number; avgLevel: number | null }[];
  }[];
  skills: {
    skill: string;
    name: string;
    tier: FhsTier;
    pairedLearners: number;
    earlyAvg: number | null;
    lateAvg: number | null;
    change: number | null;
    improved: number;
    unchanged: number;
    declined: number;
    levelMix: {
      early: { assessments: number; levels: number[] | null };
      late: { assessments: number; levels: number[] | null };
    };
    opportunityCuts: number;
    opportunityPct: number | null;
  }[];
  behaviours: {
    code: string;
    skill: string;
    kind: 'unhelpful' | 'basic' | 'advanced';
    text: string;
    pairedLearners: number;
    earlyPct: number | null;
    latePct: number | null;
    changePts: number | null;
  }[];
  unhelpfulTransitions: {
    stopped: number;
    persisted: number;
    started: number;
    never: number;
  };
  trend: {
    improving: number;
    steady: number;
    declining: number;
    tooEarly: number;
  };
  dose: { label: string; learners: number; avgChange: number | null }[];
  learners: {
    id: number;
    name: string | null;
    tenantId: string | null;
    cutsReached: number;
    earlyComposite: number;
    lateComposite: number;
    change: number;
    trend: LearnerTrend;
    skillsImproved: number;
    skillsDeclined: number;
    unhelpfulEarly: boolean;
    unhelpfulLate: boolean;
  }[];
  learnersTruncated: boolean;
}

/**
 * Everything the Skills sub-tab draws, for a panel of the first `requestedCuts`
 * cuts (or the default panel when omitted or not on offer).
 *
 * `sampleFloor` withholds an average or share over fewer learners (counts still
 * travel); `minCohort` bounds which panel sizes are offered at all.
 */
export function computeProgress(
  learners: readonly ProgressLearner[],
  opts: {
    requestedCuts?: number;
    sampleFloor: number;
    minCohort: number;
  },
): ProgressComputation {
  const T = FHS_PROGRESS_THRESHOLDS;
  const floorAvg = (n: number, v: number | null) =>
    v !== null && n >= opts.sampleFloor ? round2(v) : null;
  const floorPct = (n: number, share: number | null) =>
    share !== null && n >= opts.sampleFloor ? round1(share * 100) : null;

  const options = cohortOptions(learners, opts.minCohort);
  // A panel size nobody offers (too few learners, or a stale link) falls back
  // to the default rather than listing two or three identifiable people.
  const n = options.some((o) => o.cuts === opts.requestedCuts)
    ? (opts.requestedCuts as number)
    : defaultCuts(options, opts.sampleFloor);
  const windows = windowsFor(n);
  const { early, late } = windows;
  const cohort = learners.filter((l) => hasCompleteRun(l, n));
  const anyUnhelpful = (l: ProgressLearner, ks: readonly number[]) =>
    cutsIn(l, ks).some((c) => c.unhelpful === true);

  // ── Per skill, paired over the panel ──────────────────────────────────────
  const allCuts = learners.flatMap((l) => l.cuts);
  const skills = FHS_RUBRIC.map((s) => {
    const deltas: number[] = [];
    const earlyMeans: number[] = [];
    const lateMeans: number[] = [];
    let improved = 0;
    let unchanged = 0;
    let declined = 0;
    for (const l of cohort) {
      const w = skillWindows(l, s.key, early, late);
      if (w.early === null || w.late === null) continue;
      const d = w.late - w.early;
      deltas.push(d);
      earlyMeans.push(w.early);
      lateMeans.push(w.late);
      if (d >= T.skillFlatBand) improved += 1;
      else if (d <= -T.skillFlatBand) declined += 1;
      else unchanged += 1;
    }
    const mix = (ks: readonly number[]) => {
      const counts = [0, 0, 0, 0];
      let assessments = 0;
      for (const l of cohort) {
        for (const c of cutsIn(l, ks)) {
          const lvl = c.levels[s.key];
          if (typeof lvl === 'number' && lvl >= 1 && lvl <= 4) {
            counts[lvl - 1] += 1;
            assessments += 1;
          }
        }
      }
      return {
        assessments,
        levels: assessments >= opts.sampleFloor ? counts : null,
      };
    };
    const opportunityCuts = allCuts.filter(
      (c) => typeof c.levels[s.key] === 'number',
    ).length;
    return {
      skill: s.key,
      name: s.name,
      tier: s.tier,
      pairedLearners: deltas.length,
      earlyAvg: floorAvg(deltas.length, mean(earlyMeans)),
      lateAvg: floorAvg(deltas.length, mean(lateMeans)),
      change: floorAvg(deltas.length, mean(deltas)),
      improved,
      unchanged,
      declined,
      levelMix: { early: mix(early), late: mix(late) },
      opportunityCuts,
      opportunityPct: allCuts.length
        ? round1((opportunityCuts / allCuts.length) * 100)
        : null,
    };
  });

  // ── Per cut, over the same panel ──────────────────────────────────────────
  const byCut = range(1, n).map((k) => {
    const at = cohort
      .map((l) => l.cuts.find((c) => c.cut === k))
      .filter((c): c is ProgressCut => !!c);
    const flagged = at.filter((c) => c.unhelpful !== null);
    return {
      cut: k,
      learners: at.length,
      composite: floorAvg(at.length, mean(at.map((c) => c.score))),
      unhelpfulPct: floorPct(
        flagged.length,
        flagged.length
          ? flagged.filter((c) => c.unhelpful).length / flagged.length
          : null,
      ),
      tiers: FHS_TIERS.map((tier) => {
        const keys = FHS_RUBRIC.filter((s) => s.tier === tier).map(
          (s) => s.key,
        );
        const perLearner = at
          .map((c) =>
            mean(
              keys
                .map((key) => c.levels[key])
                .filter((v): v is number => typeof v === 'number'),
            ),
          )
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

  // ── Per behaviour code, paired over the panel ─────────────────────────────
  const behaviours = [...FHS_BEHAVIOURS_BY_CODE.values()].map((b) => {
    let paired = 0;
    let earlyShows = 0;
    let lateShows = 0;
    for (const l of cohort) {
      const assessable = (ks: readonly number[]) =>
        cutsIn(l, ks).filter((c) => typeof c.levels[b.skill] === 'number');
      const e = assessable(early);
      const la = assessable(late);
      if (!e.length || !la.length) continue;
      paired += 1;
      if (e.some((c) => c.observed.has(b.code))) earlyShows += 1;
      if (la.some((c) => c.observed.has(b.code))) lateShows += 1;
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
    };
  });

  // ── Unhelpful behaviour, per person ───────────────────────────────────────
  const unhelpfulTransitions = {
    stopped: 0,
    persisted: 0,
    started: 0,
    never: 0,
  };
  for (const l of cohort) {
    const e = anyUnhelpful(l, early);
    const la = anyUnhelpful(l, late);
    if (e && !la) unhelpfulTransitions.stopped += 1;
    else if (e && la) unhelpfulTransitions.persisted += 1;
    else if (!e && la) unhelpfulTransitions.started += 1;
    else unhelpfulTransitions.never += 1;
  }

  // ── Everyone, against their own start (not limited to the panel) ──────────
  const trends = new Map(learners.map((l) => [l.userId, learnerTrend(l)]));
  const trend = { improving: 0, steady: 0, declining: 0, tooEarly: 0 };
  for (const t of trends.values()) trend[t.trend] += 1;

  const dose = FHS_DOSE_BUCKETS.map((bucket) => {
    const changes = learners
      .filter(
        (l) =>
          l.cuts.length >= bucket.min &&
          (bucket.max === null || l.cuts.length <= bucket.max),
      )
      .map((l) => trends.get(l.userId)?.change)
      .filter((c): c is number => typeof c === 'number');
    return {
      label: bucket.label,
      learners: changes.length,
      avgChange: floorAvg(changes.length, mean(changes)),
    };
  });

  // ── The panel, one row per learner ────────────────────────────────────────
  const rows = cohort.map((l) => {
    const e = mean(cutsIn(l, early).map((c) => c.score)) as number;
    const la = mean(cutsIn(l, late).map((c) => c.score)) as number;
    let skillsImproved = 0;
    let skillsDeclined = 0;
    for (const s of FHS_RUBRIC) {
      const w = skillWindows(l, s.key, early, late);
      if (w.early === null || w.late === null) continue;
      const d = w.late - w.early;
      if (d >= T.skillFlatBand) skillsImproved += 1;
      else if (d <= -T.skillFlatBand) skillsDeclined += 1;
    }
    return {
      id: l.userId,
      name: l.name,
      tenantId: l.tenantId,
      cutsReached: l.cuts[l.cuts.length - 1]?.cut ?? 0,
      earlyComposite: round2(e),
      lateComposite: round2(la),
      change: round2(la - e),
      trend: trends.get(l.userId)?.trend ?? 'tooEarly',
      skillsImproved,
      skillsDeclined,
      unhelpfulEarly: anyUnhelpful(l, early),
      unhelpfulLate: anyUnhelpful(l, late),
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
  const measured = skills.filter((s) => s.change !== null);
  const summary = {
    cohortLearners: cohort.length,
    earlyComposite: floorAvg(cohort.length, mean(earlyComposites)),
    lateComposite: floorAvg(cohort.length, mean(lateComposites)),
    compositeChange: floorAvg(
      cohort.length,
      mean(lateComposites.map((v, i) => v - earlyComposites[i])),
    ),
    unhelpfulEarlyPct: floorPct(
      cohort.length,
      cohort.length
        ? cohort.filter((l) => anyUnhelpful(l, early)).length / cohort.length
        : null,
    ),
    unhelpfulLatePct: floorPct(
      cohort.length,
      cohort.length
        ? cohort.filter((l) => anyUnhelpful(l, late)).length / cohort.length
        : null,
    ),
    skillsUp: measured.filter((s) => (s.change as number) >= T.skillMoveBand)
      .length,
    skillsDown: measured.filter((s) => (s.change as number) <= -T.skillMoveBand)
      .length,
    skillsSteady: measured.filter(
      (s) => Math.abs(s.change as number) < T.skillMoveBand,
    ).length,
    skillsWithheld: skills.length - measured.length,
  };

  return {
    cuts: n,
    cohortOptions: options,
    windows,
    summary,
    byCut,
    skills,
    behaviours,
    unhelpfulTransitions,
    trend,
    dose,
    learners: rows.slice(0, T.maxLearnerRows),
    learnersTruncated: rows.length > T.maxLearnerRows,
  };
}
