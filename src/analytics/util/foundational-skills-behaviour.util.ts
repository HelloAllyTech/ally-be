import { FHS_BEHAVIOURS_BY_CODE } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  benjaminiHochberg,
  fisherExactP,
  icc1,
  pairedChange,
} from './paired-stats.util';
import {
  ProgressCut,
  ProgressLearner,
} from './foundational-skills-progress.util';

/**
 * Behaviour rates: how often each learner shows each rubric behaviour, and
 * whether that changed against their own start.
 *
 * Why this exists: the production quick test (2026-10-04) found the 1–4 skill
 * LEVEL carries almost no person signal (ICC ≈ 0.03 — one ticked or unticked
 * behaviour flips a level, and 73% of levels are 2), while the BEHAVIOURS under
 * it are steady personal habits (ICC 0.17–0.46 for the most person-specific,
 * robust to slice structure). So the measure here is the behaviour itself:
 *
 *  - **Rate** = slices where the learner showed the behaviour ÷ slices where
 *    its skill could be shown at all (an absent skill is no chance, never a
 *    miss). Goal-dependent behaviours therefore only count where practice
 *    raised them.
 *  - **Own start vs now** = the learner's first half of slices vs their last
 *    half, for learners with `minCuts`+ slices.
 *  - **Group change** = the paired mean of those per-learner changes, with a
 *    bootstrap CI, a sign test, and Benjamini–Hochberg across every behaviour
 *    (≈100 tests at once).
 *  - **One learner's change** = Fisher's exact test on their start vs now
 *    counts; "adopted"/"dropped" only when p ≤ `learnerP`. With a handful of
 *    slices per half that bar is deliberately hard to clear.
 *  - **Trackability** = the behaviour's ICC: how much of whether it appears is
 *    about the person rather than the slice. A behaviour with no person signal
 *    cannot show anyone changing, so it is labelled rather than charted as flat.
 */

export const FHS_BEHAVIOUR_THRESHOLDS = {
  /** Slices a learner needs before their own start vs now is compared (2 + 2). */
  minCuts: 4,
  /** ICC at or above which a behaviour counts as a trackable personal habit. */
  trackableIcc: 0.1,
  /** BH q at or below which a group change is credible. */
  groupQ: 0.05,
  /** Fisher p at or below which one learner's change is called clear. */
  learnerP: 0.05,
  /** Behaviours in the per-learner habit grid (most trackable first). */
  gridBehaviours: 10,
} as const;

export interface BehaviourCount {
  hits: number;
  chances: number;
}

export interface LearnerBehaviour {
  code: string;
  all: BehaviourCount;
  start: BehaviourCount | null;
  now: BehaviourCount | null;
  /** Fisher p, start vs now; null when either half had no chance. */
  p: number | null;
  clear: 'adopted' | 'dropped' | null;
}

export interface BehaviourRateComputation {
  measuredLearners: number;
  comparableLearners: number;
  behaviours: {
    code: string;
    skill: string;
    kind: 'unhelpful' | 'basic' | 'advanced';
    text: string;
    learnersWithChance: number;
    /** Mean of learners' own rates (each learner weighs the same), %. */
    ratePct: number | null;
    icc: number | null;
    trackable: boolean;
    change: {
      n: number;
      startPct: number | null;
      nowPct: number | null;
      changePts: number | null;
      ciPts: [number, number] | null;
      up: number;
      down: number;
      signP: number | null;
      q: number | null;
      credible: boolean;
      learnersAdopted: number;
      learnersDropped: number;
    };
  }[];
  /** Codes in the habit grid, most trackable first. */
  gridCodes: string[];
  learners: {
    id: number;
    name: string | null;
    tenantId: string | null;
    cuts: number;
    comparable: boolean;
    behaviours: LearnerBehaviour[];
  }[];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const countIn = (
  cuts: readonly ProgressCut[],
  code: string,
  skill: string,
): BehaviourCount => {
  const chances = cuts.filter((c) => typeof c.levels[skill] === 'number');
  return {
    hits: chances.filter((c) => c.observed.has(code)).length,
    chances: chances.length,
  };
};

const rate = (c: BehaviourCount | null): number | null =>
  c && c.chances > 0 ? c.hits / c.chances : null;

/** First and last half of a learner's slices (⌊k/2⌋ each), or null below `minCuts`. */
export function halves(
  learner: ProgressLearner,
): { start: ProgressCut[]; now: ProgressCut[] } | null {
  const k = learner.cuts.length;
  if (k < FHS_BEHAVIOUR_THRESHOLDS.minCuts) return null;
  const w = Math.floor(k / 2);
  return { start: learner.cuts.slice(0, w), now: learner.cuts.slice(k - w) };
}

export function computeBehaviourRates(
  learners: readonly ProgressLearner[],
  opts: { sampleFloor: number; userId?: number },
): BehaviourRateComputation {
  const T = FHS_BEHAVIOUR_THRESHOLDS;
  const floor = opts.sampleFloor;
  const defs = [...FHS_BEHAVIOURS_BY_CODE.values()];
  const split = new Map(learners.map((l) => [l.userId, halves(l)]));

  // Per learner, per behaviour.
  const perLearner = new Map<number, LearnerBehaviour[]>();
  for (const l of learners) {
    const h = split.get(l.userId) ?? null;
    perLearner.set(
      l.userId,
      defs
        .map((b): LearnerBehaviour => {
          const all = countIn(l.cuts, b.code, b.skill);
          const start = h ? countIn(h.start, b.code, b.skill) : null;
          const now = h ? countIn(h.now, b.code, b.skill) : null;
          const p =
            start && now && start.chances > 0 && now.chances > 0
              ? fisherExactP(
                  start.hits,
                  start.chances - start.hits,
                  now.hits,
                  now.chances - now.hits,
                )
              : null;
          const rs = rate(start);
          const rn = rate(now);
          const clear =
            p !== null &&
            p <= T.learnerP &&
            rs !== null &&
            rn !== null &&
            rn !== rs
              ? rn > rs
                ? ('adopted' as const)
                : ('dropped' as const)
              : null;
          return { code: b.code, all, start, now, p, clear };
        })
        .filter((x) => x.all.chances > 0),
    );
  }

  // Group view per behaviour.
  const raw = defs.map((b) => {
    const learnerRates: number[] = [];
    const presence: number[][] = [];
    const diffs: number[] = [];
    const starts: number[] = [];
    const nows: number[] = [];
    let adopted = 0;
    let dropped = 0;
    for (const l of learners) {
      const lb = perLearner.get(l.userId)?.find((x) => x.code === b.code);
      if (!lb) continue;
      const r = rate(lb.all);
      if (r !== null) learnerRates.push(r);
      presence.push(
        l.cuts
          .filter((c) => typeof c.levels[b.skill] === 'number')
          .map((c) => (c.observed.has(b.code) ? 1 : 0)),
      );
      const rs = rate(lb.start);
      const rn = rate(lb.now);
      if (rs !== null && rn !== null) {
        diffs.push((rn - rs) * 100);
        starts.push(rs * 100);
        nows.push(rn * 100);
      }
      if (lb.clear === 'adopted') adopted += 1;
      if (lb.clear === 'dropped') dropped += 1;
    }
    // An ICC from a handful of people with repeat chances is noise dressed as a
    // habit (a rare behaviour seen twice by two learners scores near 1), so it
    // is only reported once `floor` learners have had 2+ chances at it.
    const repeaters = presence.filter((x) => x.length >= 2).length;
    const icc = repeaters >= floor ? icc1(presence) : null;
    const pc = pairedChange(diffs);
    const shown = pc.n >= floor;
    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null;
    return {
      code: b.code,
      skill: b.skill,
      kind: b.kind,
      text: b.text,
      learnersWithChance: learnerRates.length,
      ratePct:
        learnerRates.length >= floor
          ? round1((mean(learnerRates) as number) * 100)
          : null,
      icc: icc === null ? null : round3(icc),
      trackable: icc !== null && icc >= T.trackableIcc,
      change: {
        n: pc.n,
        startPct: shown ? round1(mean(starts) as number) : null,
        nowPct: shown ? round1(mean(nows) as number) : null,
        changePts:
          shown && pc.meanChange !== null ? round1(pc.meanChange) : null,
        ciPts:
          shown && pc.ci
            ? ([round1(pc.ci[0]), round1(pc.ci[1])] as [number, number])
            : null,
        up: pc.up,
        down: pc.down,
        signP: shown ? pc.signP : null,
        learnersAdopted: adopted,
        learnersDropped: dropped,
      },
    };
  });
  const qs = benjaminiHochberg(raw.map((b) => b.change.signP));
  const behaviours = raw.map((b, i) => ({
    ...b,
    change: {
      ...b.change,
      signP: b.change.signP === null ? null : round3(b.change.signP),
      q: qs[i] === null ? null : round3(qs[i] as number),
      credible: qs[i] !== null && (qs[i] as number) <= T.groupQ,
    },
  }));

  // Helpful habits only: unhelpful behaviours already reach a supervisor as
  // coaching flags, and the grid is for "what does this person habitually do".
  const gridCodes = behaviours
    .filter((b) => b.trackable && b.kind !== 'unhelpful')
    .sort((a, b) => (b.icc ?? 0) - (a.icc ?? 0))
    .slice(0, T.gridBehaviours)
    .map((b) => b.code);

  const learnerRows = learners
    .filter((l) => opts.userId === undefined || l.userId === opts.userId)
    .map((l) => ({
      id: l.userId,
      name: l.name,
      tenantId: l.tenantId,
      cuts: l.cuts.length,
      comparable: split.get(l.userId) !== null,
      // The list carries only the grid's habits; one learner carries all of theirs.
      behaviours: (perLearner.get(l.userId) ?? []).filter(
        (x) => opts.userId !== undefined || gridCodes.includes(x.code),
      ),
    }))
    .sort((a, b) => b.cuts - a.cuts || a.id - b.id);

  return {
    measuredLearners: learners.length,
    comparableLearners: [...split.values()].filter(Boolean).length,
    behaviours,
    gridCodes,
    learners: learnerRows,
  };
}
