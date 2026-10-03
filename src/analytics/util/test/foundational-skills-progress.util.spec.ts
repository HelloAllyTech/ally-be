import {
  FHS_PROGRESS_THRESHOLDS,
  ProgressCut,
  ProgressLearner,
  cohortOptions,
  computeProgress,
  defaultCuts,
  hasCompleteRun,
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

/** n cuts, every one with the same levels. */
const flat = (userId: number, n: number, levels: Record<string, number>) =>
  learner(
    userId,
    Array.from({ length: n }, (_, i) => cut(i + 1, levels)),
  );

const OPTS = { sampleFloor: 2, minCohort: 2 };

describe('foundational-skills-progress util', () => {
  describe('windowsFor', () => {
    it.each([
      [2, [1], [2]],
      [3, [1], [3]],
      [4, [1, 2], [3, 4]],
      [5, [1, 2], [4, 5]],
      [6, [1, 2, 3], [4, 5, 6]],
    ])('N=%i → start %j, now %j, never overlapping', (n, early, late) => {
      expect(windowsFor(n)).toEqual({ early, late });
    });
  });

  describe('panel selection', () => {
    const learners = [
      flat(1, 6, { verbal: 3 }),
      flat(2, 5, { verbal: 3 }),
      flat(3, 3, { verbal: 3 }),
      // cut 2 missing: a gap breaks the run, so this learner only counts at N=1
      learner(4, [cut(1, { verbal: 3 }), cut(3, { verbal: 3 })]),
    ];

    it('requires every one of cuts 1..N to be scored', () => {
      expect(hasCompleteRun(learners[3], 2)).toBe(false);
      expect(hasCompleteRun(learners[1], 5)).toBe(true);
    });

    it('offers each panel size until it holds fewer than minCohort learners', () => {
      expect(cohortOptions(learners, 2)).toEqual([
        { cuts: 2, learners: 3 },
        { cuts: 3, learners: 3 },
        { cuts: 4, learners: 2 },
        { cuts: 5, learners: 2 },
      ]);
    });

    it('defaults to the largest panel meeting the sample floor, then the largest offered', () => {
      const options = cohortOptions(learners, 2);
      expect(defaultCuts(options, 3)).toBe(3);
      expect(defaultCuts(options, 10)).toBe(5);
      expect(defaultCuts([], 10)).toBe(2);
    });

    it('falls back to the default for a panel size nobody offers', () => {
      const res = computeProgress(learners, { ...OPTS, requestedCuts: 9 });
      expect(res.cuts).toBe(5);
      expect(res.summary.cohortLearners).toBe(2);
      expect(
        computeProgress(learners, { ...OPTS, requestedCuts: 3 }).cuts,
      ).toBe(3);
    });
  });

  describe('skills, paired over the panel', () => {
    // N=4 → start = cuts 1–2, now = cuts 3–4.
    const learners = [
      learner(1, [
        cut(1, { verbal: 2, goals: 2 }),
        cut(2, { verbal: 2, goals: 3 }),
        cut(3, { verbal: 3, goals: 3 }),
        cut(4, { verbal: 3 }),
      ]),
      learner(2, [
        cut(1, { verbal: 3, goals: 3 }),
        cut(2, { verbal: 3 }),
        cut(3, { verbal: 3, goals: 1 }),
        cut(4, { verbal: 3, goals: 1 }),
      ]),
      // goals only ever assessable at the start: excluded from goals, kept for verbal
      learner(3, [
        cut(1, { verbal: 2, goals: 2 }),
        cut(2, { verbal: 2 }),
        cut(3, { verbal: 2 }),
        cut(4, { verbal: 2 }),
      ]),
    ];
    const res = computeProgress(learners, { ...OPTS, requestedCuts: 4 });
    const skill = (key: string) => res.skills.find((s) => s.skill === key)!;

    it('compares each learner with their own start, skipping no-opportunity cuts', () => {
      expect(skill('verbal')).toMatchObject({
        pairedLearners: 3,
        earlyAvg: 2.33,
        lateAvg: 2.67,
        change: 0.33,
        improved: 1,
        unchanged: 2,
        declined: 0,
      });
      // learner 1: 2.5 → 3 (+0.5 improved); learner 2: 3 → 1 (declined)
      expect(skill('goals')).toMatchObject({
        pairedLearners: 2,
        improved: 1,
        declined: 1,
        unchanged: 0,
      });
    });

    it('withholds averages below the floor but keeps the counts', () => {
      const strict = computeProgress(learners, {
        sampleFloor: 3,
        minCohort: 2,
        requestedCuts: 4,
      });
      const goals = strict.skills.find((s) => s.skill === 'goals')!;
      expect(goals).toMatchObject({
        pairedLearners: 2,
        earlyAvg: null,
        lateAvg: null,
        change: null,
        improved: 1,
        declined: 1,
      });
      expect(strict.summary.skillsWithheld).toBe(13);
    });

    it('counts level mix per window and opportunity across every scored cut', () => {
      expect(skill('goals').levelMix.late).toEqual({
        assessments: 3,
        levels: [2, 0, 1, 0],
      });
      // goals assessable in 7 of 12 cuts platform-wide
      expect(skill('goals').opportunityCuts).toBe(7);
      expect(skill('goals').opportunityPct).toBe(58.3);
      expect(skill('confidentiality')).toMatchObject({
        pairedLearners: 0,
        change: null,
        opportunityCuts: 0,
        opportunityPct: 0,
      });
    });

    it('labels a skill moving only beyond the move band', () => {
      expect(res.summary.skillsUp).toBe(1); // verbal +0.33
      expect(res.summary.skillsDown).toBe(1); // goals −0.75
      expect(res.summary.skillsSteady).toBe(0);
    });

    it('averages each tier per learner before averaging across learners', () => {
      const engage = res.byCut[0].tiers.find((t) => t.tier === 'engage')!;
      expect(engage).toEqual({ tier: 'engage', learners: 3, avgLevel: 2.33 });
      const support = res.byCut[3].tiers.find((t) => t.tier === 'support')!;
      expect(support.learners).toBe(1);
    });
  });

  describe('behaviours and unhelpful transitions', () => {
    const withCodes = (k: number, codes: string[], unhelpful: boolean) =>
      cut(
        k,
        { verbal: unhelpful ? 1 : 3 },
        { observed: new Set(codes), unhelpful },
      );
    const learners = [
      learner(1, [
        withCodes(1, ['verbal.u1'], true),
        withCodes(2, ['verbal.b1'], false),
      ]),
      learner(2, [
        withCodes(1, ['verbal.u1'], true),
        withCodes(2, ['verbal.u1', 'verbal.b1'], true),
      ]),
      learner(3, [withCodes(1, [], false), withCodes(2, ['verbal.u1'], true)]),
      learner(4, [withCodes(1, [], false), withCodes(2, ['verbal.b1'], false)]),
    ];
    const res = computeProgress(learners, { ...OPTS, requestedCuts: 2 });

    it('reports the paired share showing each behaviour at the start and now', () => {
      const u1 = res.behaviours.find((b) => b.code === 'verbal.u1')!;
      expect(u1).toMatchObject({
        skill: 'verbal',
        kind: 'unhelpful',
        pairedLearners: 4,
        earlyPct: 50,
        latePct: 50,
        changePts: 0,
      });
      expect(u1.text.length).toBeGreaterThan(10);
      const b1 = res.behaviours.find((b) => b.code === 'verbal.b1')!;
      expect(b1).toMatchObject({ earlyPct: 0, latePct: 75, changePts: 75 });
    });

    it('sorts every panel learner into one unhelpful transition', () => {
      expect(res.unhelpfulTransitions).toEqual({
        stopped: 1,
        persisted: 1,
        started: 1,
        never: 1,
      });
      expect(res.summary.unhelpfulEarlyPct).toBe(50);
      expect(res.summary.unhelpfulLatePct).toBe(50);
    });
  });

  describe('people', () => {
    it('classifies a learner only once they have trendMinCuts cuts', () => {
      expect(FHS_PROGRESS_THRESHOLDS.trendMinCuts).toBe(4);
      expect(learnerTrend(flat(1, 3, { verbal: 2 })).trend).toBe('tooEarly');
      const up = learner(2, [
        cut(1, {}, { score: 2 }),
        cut(2, {}, { score: 2 }),
        cut(3, {}, { score: 2.2 }),
        cut(4, {}, { score: 2.2 }),
      ]);
      const upTrend = learnerTrend(up);
      expect(upTrend.trend).toBe('improving');
      expect(upTrend.change).toBeCloseTo(0.2);
      const steady = learner(3, [
        cut(1, {}, { score: 2 }),
        cut(2, {}, { score: 2 }),
        cut(3, {}, { score: 2.1 }),
        cut(4, {}, { score: 2.1 }),
      ]);
      expect(learnerTrend(steady).trend).toBe('steady');
    });

    it('buckets own change by practice volume', () => {
      const learners = [
        flat(1, 1, { verbal: 2 }),
        flat(2, 2, { verbal: 2 }),
        flat(3, 3, { verbal: 2 }),
        flat(4, 4, { verbal: 2 }),
        flat(5, 11, { verbal: 2 }),
      ];
      const res = computeProgress(learners, { ...OPTS });
      expect(res.dose.map((d) => [d.label, d.learners])).toEqual([
        ['2–3 cuts', 2],
        ['4–5 cuts', 1],
        ['6–9 cuts', 0],
        ['10+ cuts', 1],
      ]);
      expect(res.dose[0].avgChange).toBe(0);
      expect(res.dose[1].avgChange).toBeNull();
      expect(res.trend).toEqual({
        improving: 0,
        steady: 2,
        declining: 0,
        tooEarly: 3,
      });
    });

    it('lists panel learners, biggest own change first', () => {
      const learners = [
        learner(1, [cut(1, { verbal: 3 }), cut(2, { verbal: 2 })]),
        learner(2, [cut(1, { verbal: 2 }), cut(2, { verbal: 3 })]),
        learner(3, [cut(1, { verbal: 1 }), cut(2, { verbal: 3 })]),
      ];
      const res = computeProgress(learners, { ...OPTS, requestedCuts: 2 });
      expect(res.learners.map((l) => [l.id, l.change])).toEqual([
        [3, 2],
        [2, 1],
        [1, -1],
      ]);
      expect(res.learners[0]).toMatchObject({
        earlyComposite: 1,
        lateComposite: 3,
        skillsImproved: 1,
        skillsDeclined: 0,
        unhelpfulEarly: true,
        unhelpfulLate: false,
        cutsReached: 2,
        trend: 'tooEarly',
      });
      expect(res.learnersTruncated).toBe(false);
    });
  });

  it('returns an honest empty result when nobody has two cuts', () => {
    const res = computeProgress([flat(1, 1, { verbal: 2 })], OPTS);
    expect(res.cuts).toBe(2);
    expect(res.cohortOptions).toEqual([]);
    expect(res.summary.cohortLearners).toBe(0);
    expect(res.summary.compositeChange).toBeNull();
    expect(res.byCut.every((c) => c.learners === 0)).toBe(true);
    expect(res.learners).toEqual([]);
  });
});
