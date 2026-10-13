import { FHS_BEHAVIOURS_BY_CODE } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { pairedChange } from './paired-stats.util';

/**
 * Advanced helping behaviours by practice depth (AAQ-237): does a learner show
 * advanced behaviours more often in their later practice than in their
 * earlier practice, and does that differ with how much they have practised?
 *
 * Why this exists: a one-off production read (2026-10-12) found learners with
 * 6+ scored slices showing advanced behaviours in a larger share of their
 * chances later on (15 of 19 rose), surviving scenario adjustment, while the
 * same change across everyone with 4+ slices was flat. That is a hypothesis,
 * not a result, and this chart exists so it can be watched as practice
 * accumulates rather than re-derived by hand.
 *
 *  - **Rate** per slice = advanced behaviours shown ÷ advanced behaviours the
 *    slice gave a chance at (the advanced codes of every skill it could
 *    assess). An absent skill is no chance, never a miss — the same rule as
 *    the habit rates.
 *  - **Scenario adjustment** (leave one learner out): each scenario's effect is
 *    how far other learners' slices of it sit from those learners' own
 *    averages, weighted by the scenario's share of sessions in the slice. A
 *    learner's slice is adjusted by the mix it was cut from, using effects
 *    estimated without them, so their own change cannot leak into the
 *    adjustment. On a fixed course order this also absorbs some real learning
 *    (late scenarios are played by people who have practised more), so the
 *    adjusted change errs small.
 *  - **Own start vs now** = mean rate of the first half of the learner's
 *    compared slices against the last half (from `baselineFrom`, so slice 1
 *    can be set aside as a warm-up).
 *  - **Tiers are nested** (4+, 6+, 8+, 10+ scored slices): each row is "everyone
 *    with at least this much practice", not an independent group, so the rows
 *    are four looks at one question.
 */

export const FHS_ADVANCED_THRESHOLDS = {
  /** Nested tiers: learners with at least this many scored slices. */
  depths: [4, 6, 8, 10],
  /** Compared slices a learner needs (one each side). */
  minComparedSlices: 2,
  /** Other learners a scenario needs before its effect is estimated (else 0). */
  minOtherLearnersPerScenario: 2,
} as const;

export interface AdvancedCut {
  cut: number;
  levels: Record<string, number>;
  observed: ReadonlySet<string>;
  /** Sessions per scenario id in this slice (sessions without a scenario left out). */
  scenarios: ReadonlyMap<number, number>;
}

export interface AdvancedLearner {
  userId: number;
  /** Ascending by cut, one entry per scored cut. */
  cuts: AdvancedCut[];
}

export interface AdvancedTier {
  minSlices: number;
  learners: number;
  startPct: number | null;
  nowPct: number | null;
  startPerSlice: number | null;
  nowPerSlice: number | null;
  rawChangePts: number | null;
  changePts: number | null;
  ciPts: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const mean = (xs: readonly number[]): number =>
  xs.reduce((a, v) => a + v, 0) / xs.length;

/** Advanced codes per skill, from the rubric. */
const ADVANCED_BY_SKILL: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const b of FHS_BEHAVIOURS_BY_CODE.values()) {
    if (b.kind === 'advanced') m.set(b.skill, (m.get(b.skill) ?? 0) + 1);
  }
  return m;
})();

/** Advanced behaviours shown and possible in one slice. */
export function advancedCounts(c: AdvancedCut): {
  hits: number;
  chances: number;
} {
  let chances = 0;
  for (const skill of Object.keys(c.levels)) {
    if (typeof c.levels[skill] === 'number') {
      chances += ADVANCED_BY_SKILL.get(skill) ?? 0;
    }
  }
  let hits = 0;
  for (const code of c.observed) {
    const b = FHS_BEHAVIOURS_BY_CODE.get(code);
    if (b?.kind === 'advanced' && typeof c.levels[b.skill] === 'number') {
      hits += 1;
    }
  }
  return { hits, chances };
}

interface SliceRate {
  cut: number;
  rate: number;
  hits: number;
  /** Scenario share of the slice's sessions. */
  weights: [number, number][];
}

const sliceRates = (l: AdvancedLearner): SliceRate[] =>
  l.cuts.flatMap((c) => {
    const { hits, chances } = advancedCounts(c);
    if (chances === 0) return [];
    const total = [...c.scenarios.values()].reduce((a, v) => a + v, 0);
    return [
      {
        cut: c.cut,
        rate: hits / chances,
        hits,
        weights:
          total > 0
            ? [...c.scenarios].map(
                ([s, n]) => [s, n / total] as [number, number],
              )
            : [],
      },
    ];
  });

/**
 * Leave-one-learner-out scenario effects: `effect(scenario, userId)` is the
 * weighted mean residual (slice rate − that learner's own mean) of every OTHER
 * learner's slices of the scenario, or 0 when fewer than
 * `minOtherLearnersPerScenario` other learners played it.
 */
function scenarioEffects(
  rates: ReadonlyMap<number, SliceRate[]>,
): (scenarioId: number, userId: number) => number {
  // scenario → user → [Σ w·residual, Σ w]
  const acc = new Map<number, Map<number, [number, number]>>();
  for (const [userId, slices] of rates) {
    if (slices.length === 0) continue;
    const own = mean(slices.map((s) => s.rate));
    for (const s of slices) {
      for (const [scenarioId, w] of s.weights) {
        let byUser = acc.get(scenarioId);
        if (!byUser) acc.set(scenarioId, (byUser = new Map()));
        const cell = byUser.get(userId) ?? [0, 0];
        cell[0] += w * (s.rate - own);
        cell[1] += w;
        byUser.set(userId, cell);
      }
    }
  }
  const totals = new Map<number, [number, number, number]>();
  for (const [scenarioId, byUser] of acc) {
    let num = 0;
    let den = 0;
    for (const [n, d] of byUser.values()) {
      num += n;
      den += d;
    }
    totals.set(scenarioId, [num, den, byUser.size]);
  }
  return (scenarioId, userId) => {
    const t = totals.get(scenarioId);
    if (!t) return 0;
    const mine = acc.get(scenarioId)?.get(userId);
    const others = t[2] - (mine ? 1 : 0);
    const den = t[1] - (mine ? mine[1] : 0);
    if (
      others < FHS_ADVANCED_THRESHOLDS.minOtherLearnersPerScenario ||
      den <= 0
    ) {
      return 0;
    }
    return (t[0] - (mine ? mine[0] : 0)) / den;
  };
}

interface LearnerChange {
  slices: number;
  rawStart: number;
  rawNow: number;
  adjStart: number;
  adjNow: number;
  perSliceStart: number;
  perSliceNow: number;
}

export function computeAdvancedByDepth(
  learners: readonly AdvancedLearner[],
  opts: { baselineFrom: 1 | 2; sampleFloor: number; minCohort: number },
): { tiers: AdvancedTier[] } {
  const T = FHS_ADVANCED_THRESHOLDS;
  const rates = new Map(learners.map((l) => [l.userId, sliceRates(l)]));
  const effect = scenarioEffects(rates);

  const changes: LearnerChange[] = [];
  for (const l of learners) {
    const compared = (rates.get(l.userId) ?? []).filter(
      (s) => s.cut >= opts.baselineFrom,
    );
    if (compared.length < T.minComparedSlices) continue;
    const w = Math.floor(compared.length / 2);
    const adjusted = (s: SliceRate) =>
      s.rate -
      s.weights.reduce((a, [sc, wt]) => a + wt * effect(sc, l.userId), 0);
    const start = compared.slice(0, w);
    const now = compared.slice(compared.length - w);
    changes.push({
      slices: l.cuts.length,
      rawStart: mean(start.map((s) => s.rate)),
      rawNow: mean(now.map((s) => s.rate)),
      adjStart: mean(start.map(adjusted)),
      adjNow: mean(now.map(adjusted)),
      perSliceStart: mean(start.map((s) => s.hits)),
      perSliceNow: mean(now.map((s) => s.hits)),
    });
  }

  const tiers = T.depths.flatMap((minSlices): AdvancedTier[] => {
    const inTier = changes.filter((c) => c.slices >= minSlices);
    if (inTier.length < opts.minCohort) return [];
    const pc = pairedChange(inTier.map((c) => (c.adjNow - c.adjStart) * 100));
    const shown = inTier.length >= opts.sampleFloor;
    const avg = (pick: (c: LearnerChange) => number, scale: number) =>
      shown ? round1(mean(inTier.map(pick)) * scale) : null;
    return [
      {
        minSlices,
        learners: inTier.length,
        startPct: avg((c) => c.rawStart, 100),
        nowPct: avg((c) => c.rawNow, 100),
        startPerSlice: avg((c) => c.perSliceStart, 1),
        nowPerSlice: avg((c) => c.perSliceNow, 1),
        rawChangePts: avg((c) => c.rawNow - c.rawStart, 100),
        changePts:
          shown && pc.meanChange !== null ? round1(pc.meanChange) : null,
        ciPts:
          shown && pc.ci
            ? ([round1(pc.ci[0]), round1(pc.ci[1])] as [number, number])
            : null,
        up: pc.up,
        down: pc.down,
        tied: pc.tied,
        signP: shown && pc.signP !== null ? round3(pc.signP) : null,
        detectable: shown && pc.detectable,
      },
    ];
  });

  return { tiers };
}
