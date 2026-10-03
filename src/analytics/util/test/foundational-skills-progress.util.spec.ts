import {
  FHS_PROGRESS_THRESHOLDS,
  ProgressCut,
  ProgressLearner,
  cohortOptions,
  compositeIcc,
  computeProgress,
  countLevelMismatches,
  cutNoiseSd,
  defaultCuts,
  hasCompleteRun,
  learnerBand,
  learnerTrend,
  windowsFor,
} from '../foundational-skills-progress.util';

const cut = (
  k: number,
  levels: Record<string, number>,
  extra: Partial<ProgressCut> = {},
): ProgressCut => {
  const vals = Object.values(levels);
  return {
    cut: k,
    score: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 2,
    unhelpful: vals.some((v) => v === 1),
    levels,
    observed: new Set<string>(),
    ...extra,
  };
};

const learner = (userId: number, cuts: ProgressCut[]): ProgressLearner => ({
  userId,
  name: `Learner ${userId}`,
  tenantId: 't-1',
  cuts,
});

const flat = (userId: number, n: number, levels: Record<string, number>) =>
  learner(
    userId,
    Array.from({ length: n }, (_, i) => cut(i + 1, levels)),
  );

const OPTS = { sampleFloor: 2, minCohort: 2 };

describe('foundational-skills-progress util', () => {
  describe('windowsFor', () => {
    it.each([
      [2, 1, [1], [2], 1],
      [5, 1, [1, 2], [4, 5], 1],
      [6, 1, [1, 2, 3], [4, 5, 6], 1],
      [5, 2, [2, 3], [4, 5], 2],
      [3, 2, [2], [3], 2],
      // too short to leave cut 1 out: falls back
      [2, 2, [1], [2], 1],
    ])(
      'N=%i from %i → start %j, now %j (from %i)',
      (n, from, early, late, used) => {
        expect(windowsFor(n, from as 1 | 2)).toEqual({
          early,
          late,
          from: used,
        });
      },
    );
  });

  describe('panel selection', () => {
    const learners = [
      flat(1, 6, { verbal: 3 }),
      flat(2, 5, { verbal: 3 }),
      flat(3, 3, { verbal: 3 }),
      learner(4, [cut(1, { verbal: 3 }), cut(3, { verbal: 3 })]),
    ];

    it('requires every one of cuts 1..N and offers sizes down to minCohort', () => {
      expect(hasCompleteRun(learners[3], 2)).toBe(false);
      expect(cohortOptions(learners, 2).map((o) => o.cuts)).toEqual([
        2, 3, 4, 5,
      ]);
      expect(defaultCuts(cohortOptions(learners, 2), 3)).toBe(3);
      expect(defaultCuts([], 10)).toBe(2);
    });

    it('falls back to the default for a size nobody offers', () => {
      expect(
        computeProgress(learners, { ...OPTS, requestedCuts: 9 }).cuts,
      ).toBe(5);
    });
  });

  describe('noise', () => {
    it('estimates slice noise from consecutive cuts and an ICC near zero for pure noise', () => {
      // Every learner alternates 2.0 / 2.4: all variation is within-learner.
      const noisy = [1, 2, 3, 4].map((id) =>
        learner(
          id,
          [1, 2, 3, 4, 5, 6].map((k) => cut(k, {}, { score: k % 2 ? 2 : 2.4 })),
        ),
      );
      expect(cutNoiseSd(noisy)).toBeCloseTo(0.4 / Math.SQRT2, 2);
      expect(compositeIcc(noisy)).toBeLessThan(0.05);

      // Learners differ consistently: most variance belongs to the learner.
      const stable = [1.5, 2, 2.5, 3].map((base, id) =>
        learner(
          id,
          [1, 2, 3, 4].map((k) =>
            cut(k, {}, { score: base + (k % 2 ? 0.05 : -0.05) }),
          ),
        ),
      );
      expect(compositeIcc(stable)).toBeGreaterThan(0.9);
    });

    it('sizes a learner band to the noise and the window', () => {
      expect(learnerBand(0.2, 2)).toBeCloseTo(0.392, 3);
      expect(learnerBand(0.2, 8)).toBeCloseTo(0.196, 3);
    });

    it('classifies own trend against the noise band, and too early below 4 cuts', () => {
      const mk = (scores: number[]) =>
        learner(
          1,
          scores.map((s, i) => cut(i + 1, {}, { score: s })),
        );
      expect(learnerTrend(mk([2, 2, 2]), 0.2).trend).toBe('tooEarly');
      expect(learnerTrend(mk([2, 2, 2.3, 2.3]), 0.2).trend).toBe('steady'); // +0.3 < 0.39
      expect(learnerTrend(mk([2, 2, 2.5, 2.5]), 0.2).trend).toBe('improving');
      expect(learnerTrend(mk([2.5, 2.5, 2, 2]), 0.2).trend).toBe('declining');
    });
  });

  describe('skills', () => {
    // 4 learners, verbal clearly up in every one; rapport pinned at 2; harm rare.
    const learners = [1, 2, 3, 4].map((id) =>
      learner(id, [
        cut(1, { verbal: 2, rapport: 2, goals: 2 + (id % 2) }),
        cut(2, { verbal: 2, rapport: 2, goals: 2, harm: 2 }),
        cut(3, { verbal: 3, rapport: 2, goals: 3 - (id % 2) }),
        cut(4, { verbal: 3, rapport: 2, goals: 2 }),
      ]),
    );
    const res = computeProgress(learners, { ...OPTS, requestedCuts: 4 });
    const skill = (key: string) => res.skills.find((s) => s.skill === key)!;

    it('carries a CI and calls a move only when it excludes zero', () => {
      expect(skill('verbal')).toMatchObject({
        n: 4,
        change: 1,
        up: 4,
        down: 0,
        detectable: true,
        measurability: 'measurable',
      });
      expect(skill('verbal').ci).toEqual([1, 1]);
      expect(skill('goals').detectable).toBe(false);
    });

    it('labels capped and rarely tested skills as not measurable', () => {
      expect(skill('rapport').measurability).toBe('capped');
      expect(skill('rapport').detectable).toBe(false);
      // 25% is not below the 25% bar, and every harm score is a 2: capped, not rare
      expect(skill('harm').measurability).toBe('capped');
      expect(skill('confidentiality').measurability).toBe('rare');
      expect(res.summary.skills).toMatchObject({
        detectableUp: 1,
        detectableDown: 0,
      });
      expect(res.summary.skills.notMeasurable).toBeGreaterThanOrEqual(3);
    });

    it('counts learners with one and two-plus chances at each skill', () => {
      expect(skill('harm')).toMatchObject({
        learnersWithOpportunity: 4,
        learnersWithTwoPlus: 0,
        opportunityCuts: 4,
        opportunityPct: 25,
      });
    });

    it('pairs tiers and puts a CI on each cut average', () => {
      const engage = res.tiers.find((t) => t.tier === 'engage')!;
      expect(engage.n).toBe(4);
      expect(engage.change).toBeGreaterThan(0);
      expect(res.byCut[0].compositeCi).not.toBeNull();
    });
  });

  describe('behaviours', () => {
    const withCodes = (k: number, codes: string[]) =>
      cut(k, { verbal: 3 }, { observed: new Set(codes) });
    const learners = [1, 2, 3, 4, 5, 6].map((id) =>
      learner(id, [
        withCodes(1, id <= 2 ? ['verbal.b1'] : []),
        withCodes(2, ['verbal.b1']),
      ]),
    );
    const res = computeProgress(learners, { ...OPTS, requestedCuts: 2 });
    const b1 = res.behaviours.find((b) => b.code === 'verbal.b1')!;

    it('counts gained vs lost with an exact test and a BH q-value', () => {
      expect(b1).toMatchObject({
        pairedLearners: 6,
        earlyPct: 33.3,
        latePct: 100,
        gained: 4,
        lost: 0,
      });
      expect(b1.signP).toBeCloseTo(0.125, 3);
      expect(b1.q).not.toBeNull();
      expect(b1.credible).toBe(false); // 4/0 cannot clear q ≤ 0.05
    });

    it('profiles every learner: first slice and ever', () => {
      expect(b1).toMatchObject({
        firstSliceLearners: 6,
        firstSlicePct: 33.3,
        everLearners: 6,
        everPct: 100,
      });
    });
  });

  describe('safety and coaching flags', () => {
    const c = (k: number, levels: Record<string, number>, codes: string[]) =>
      cut(k, levels, { observed: new Set(codes) });
    const learners = [
      // missed, then followed up: better
      learner(1, [
        c(1, { verbal: 3, harm: 1 }, ['harm.u1']),
        c(2, { verbal: 3, harm: 2 }, ['harm.b1']),
      ]),
      // followed, then missed: worse
      learner(2, [
        c(1, { verbal: 3, harm: 2 }, ['harm.b1']),
        c(2, { verbal: 3, harm: 1 }, ['harm.u1']),
      ]),
      // both coded in one cut: unclear
      learner(3, [
        c(1, { verbal: 3, harm: 1 }, ['harm.u1', 'harm.b1']),
        c(2, { verbal: 3 }, []),
      ]),
      // confidentiality: explained, promised absolute
      learner(4, [
        c(1, { verbal: 3, confidentiality: 1 }, [
          'confidentiality.b1',
          'confidentiality.u3',
        ]),
        c(2, { verbal: 1, functioning: 1 }, ['verbal.u1', 'functioning.u2']),
        c(3, { verbal: 1, functioning: 1 }, ['verbal.u1', 'functioning.u2']),
      ]),
    ];
    const res = computeProgress(learners, { ...OPTS, requestedCuts: 2 });

    it('counts self-harm cues met, followed up, missed and unclear', () => {
      expect(res.safety.selfHarm).toMatchObject({
        learnersWithCue: 3,
        cutsWithCue: 5,
        cutsFollowedUp: 2,
        cutsMissed: 2,
        cutsAmbiguous: 1,
        learnersMissedFirst: 1,
        learnersFollowedFirst: 1,
        learnersAmbiguousFirst: 1,
        repeatLearners: 2,
        repeatBetter: 1,
        repeatWorse: 1,
        repeatSame: 0,
      });
    });

    it('counts confidentiality explanations and absolute promises per learner', () => {
      expect(res.safety.confidentiality).toMatchObject({
        learnersAssessable: 1,
        learnersExplained: 1,
        learnersListedExceptions: 0,
        learnersPromisedAbsolute: 1,
      });
    });

    it('flags any safety code once, and other unhelpful codes only when repeated', () => {
      const four = res.learners.find((l) => l.id === 4)!;
      expect(four.flags.map((f) => [f.code, f.kind, f.cuts, f.recent])).toEqual(
        [
          ['confidentiality.u3', 'safety', [1], false],
          ['verbal.u1', 'repeat', [2, 3], true],
          ['functioning.u2', 'repeat', [2, 3], true],
        ],
      );
      const two = res.learners.find((l) => l.id === 2)!;
      expect(two.flags.map((f) => f.code)).toEqual(['harm.u1']);
    });
  });

  it('reports unhelpful transitions with a CI, the depth funnel and precision', () => {
    const learners = [
      learner(1, [cut(1, { verbal: 1 }), cut(2, { verbal: 3 })]),
      learner(2, [cut(1, { verbal: 1 }), cut(2, { verbal: 1 })]),
      learner(3, [cut(1, { verbal: 3 }), cut(2, { verbal: 1 })]),
      learner(4, [
        cut(1, { verbal: 3 }),
        cut(2, { verbal: 3 }),
        cut(3, { verbal: 3 }),
      ]),
    ];
    const res = computeProgress(learners, { ...OPTS, requestedCuts: 2 });
    expect(res.summary.unhelpful).toMatchObject({
      earlyPct: 50,
      latePct: 50,
      changePts: 0,
      stopped: 1,
      started: 1,
      persisted: 1,
      never: 1,
      signP: 1,
      detectable: false,
    });
    expect(res.summary.unhelpful.ciPts).not.toBeNull();
    expect(res.depth).toEqual([
      { atLeast: 1, learners: 4 },
      { atLeast: 2, learners: 4 },
      { atLeast: 3, learners: 1 },
      { atLeast: 5, learners: 0 },
      { atLeast: 10, learners: 0 },
    ]);
    expect(res.precision.cutNoiseSd).not.toBeNull();
    expect(res.precision.learnerBand).not.toBeNull();
    expect(res.learners[0].band).toBe(res.precision.learnerBand);
  });

  it('counts stored levels that disagree with their codes', () => {
    const derive = (_s: string, observed: Set<string>) =>
      observed.has('x.b1') ? 3 : 2;
    expect(
      countLevelMismatches(
        [
          [
            { skill: 'x', level: 3, observed: ['x.b1'] },
            { skill: 'x', level: 3, observed: [] },
          ],
          [{ skill: 'x', level: null }],
        ],
        derive,
      ),
    ).toEqual({ checked: 2, mismatched: 1 });
  });

  it('returns an honest empty result when nobody has two cuts', () => {
    const res = computeProgress([flat(1, 1, { verbal: 2 })], OPTS);
    expect(res.cuts).toBe(2);
    expect(res.cohortOptions).toEqual([]);
    expect(res.summary.cohortLearners).toBe(0);
    expect(res.summary.composite.change).toBeNull();
    expect(res.learners).toEqual([]);
    expect(FHS_PROGRESS_THRESHOLDS.trendMinCuts).toBe(4);
  });
});
