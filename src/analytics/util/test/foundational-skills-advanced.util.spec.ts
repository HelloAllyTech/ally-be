import {
  AdvancedCut,
  AdvancedLearner,
  FHS_ADVANCED_THRESHOLDS,
  advancedCounts,
  computeAdvancedByDepth,
} from '../foundational-skills-advanced.util';

// verbal has two advanced behaviours (a1, a2) and empathy one (a1).
const NONE: string[] = [];
const BOTH = ['verbal.a1', 'verbal.a2'];

const cut = (
  k: number,
  codes: string[],
  scenarios: [number, number][] = [],
  levels: Record<string, number> = { verbal: 3 },
): AdvancedCut => ({
  cut: k,
  levels,
  observed: new Set(codes),
  scenarios: new Map(scenarios),
});
const learner = (userId: number, cuts: AdvancedCut[]): AdvancedLearner => ({
  userId,
  cuts,
});
const loose = { baselineFrom: 1 as const, sampleFloor: 1, minCohort: 1 };

describe('advanced behaviours by practice depth', () => {
  it('counts advanced behaviours only where their skill could be shown', () => {
    expect(
      advancedCounts(
        cut(1, ['verbal.a1', 'verbal.b1', 'empathy.a1'], [], {
          verbal: 4,
          empathy: 2,
        }),
      ),
    ).toEqual({ hits: 2, chances: 3 }); // basic code ignored
    // empathy not assessable: its code is neither a hit nor a chance
    expect(advancedCounts(cut(1, ['empathy.a1']))).toEqual({
      hits: 0,
      chances: 2,
    });
  });

  it('compares first and last half from baselineFrom, so slice 1 can be a warm-up', () => {
    const l = learner(1, [
      cut(1, NONE),
      cut(2, BOTH),
      cut(3, BOTH),
      cut(4, NONE),
      cut(5, NONE),
    ]);
    const from2 = computeAdvancedByDepth([l], { ...loose, baselineFrom: 2 });
    expect(from2.tiers[0]).toMatchObject({
      minSlices: 4,
      startPct: 100,
      nowPct: 0,
      changePts: -100,
    });
    const from1 = computeAdvancedByDepth([l], loose);
    expect(from1.tiers[0]).toMatchObject({ startPct: 50, nowPct: 0 });
  });

  it('adjusts for scenario using effects estimated from other learners only', () => {
    // Scenario 2 draws advanced behaviours from everyone; learner 1 simply
    // played it last. Learners 2 and 3 interleave the two scenarios.
    const A: [number, number][] = [[1, 1]];
    const B: [number, number][] = [[2, 1]];
    const interleaved = (id: number) =>
      learner(id, [
        cut(1, NONE, A),
        cut(2, BOTH, B),
        cut(3, NONE, A),
        cut(4, BOTH, B),
      ]);
    const lateEasy = learner(1, [
      cut(1, NONE, A),
      cut(2, NONE, A),
      cut(3, BOTH, B),
      cut(4, BOTH, B),
    ]);
    const [tier] = computeAdvancedByDepth(
      [lateEasy, interleaved(2), interleaved(3)],
      loose,
    ).tiers;
    expect(tier.rawChangePts).toBe(33.3); // (100 + 0 + 0) / 3
    expect(tier.changePts).toBe(0);
    expect(tier).toMatchObject({ up: 0, down: 0, tied: 3 });
  });

  it('leaves a scenario unadjusted until enough other learners played it', () => {
    expect(FHS_ADVANCED_THRESHOLDS.minOtherLearnersPerScenario).toBe(2);
    const solo = learner(1, [
      cut(1, NONE, [[1, 1]]),
      cut(2, NONE, [[1, 1]]),
      cut(3, BOTH, [[9, 1]]),
      cut(4, BOTH, [[9, 1]]),
    ]);
    const other = learner(2, [
      cut(1, NONE, [[9, 1]]),
      cut(2, BOTH, [[9, 1]]),
      cut(3, NONE, [[1, 1]]),
      cut(4, BOTH, [[1, 1]]),
    ]);
    const [tier] = computeAdvancedByDepth([solo, other], loose).tiers;
    // One other learner per scenario: no effect estimated, adjusted = raw.
    expect(tier.changePts).toBe(tier.rawChangePts);
  });

  it('nests tiers by scored slices and withholds averages below the floor', () => {
    const rising = (id: number, k: number) =>
      learner(
        id,
        Array.from({ length: k }, (_, i) =>
          cut(i + 1, i < k / 2 ? NONE : BOTH),
        ),
      );
    const learners = [
      rising(1, 4),
      rising(2, 4),
      rising(3, 6),
      rising(4, 6),
      rising(5, 8),
    ];
    const r = computeAdvancedByDepth(learners, {
      baselineFrom: 1,
      sampleFloor: 4,
      minCohort: 2,
    });
    expect(r.tiers.map((t) => [t.minSlices, t.learners])).toEqual([
      [4, 5],
      [6, 3],
    ]); // 8+ has one learner: under minCohort, not listed
    expect(r.tiers[0]).toMatchObject({ changePts: 100, up: 5 });
    expect(r.tiers[1]).toMatchObject({
      startPct: null,
      changePts: null,
      ciPts: null,
      signP: null,
      detectable: false,
      up: 3,
      down: 0,
    });
  });
});
