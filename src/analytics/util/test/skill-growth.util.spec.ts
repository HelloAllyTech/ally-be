import type { FoundationalSkillsLearnerCutRow } from '../../repository/foundational-skills-analytics.repository';
import {
  FHS_PROGRESS_THRESHOLDS,
  computeProgress,
  cutNoiseSd,
  learnerBand,
  learnerTrend,
} from '../foundational-skills-progress.util';
import {
  SKILL_GROWTH_EXPERIENCED_MIN_CUTS,
  SKILL_GROWTH_MAX_ORDINAL,
  SKILL_TREND_CLASS_BY_LEARNER_TREND,
  SkillGrowthLearner,
  buildSkillGrowthCurve,
  buildSkillTrendMix,
  classifySkillGrowthLearner,
  cutScenarioTitle,
  percentileCont,
  skillTrendThresholds,
  sortSkillGrowthLearners,
  toSkillGrowthLearners,
} from '../skill-growth.util';

/** A scored cut as `getAllLearnerCuts` returns it. */
const row = (
  userId: number,
  cut: number,
  score: number,
  extra: Partial<FoundationalSkillsLearnerCutRow> = {},
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: `Learner ${userId}`,
  tenantId: 'org-a',
  cut,
  closedAt: new Date(Date.UTC(2026, 6, cut, 12)),
  score,
  unhelpful: false,
  levels: { empathy: Math.round(score) },
  verdicts: [],
  sessionIds: [`s-${userId}-${cut}`],
  ...extra,
});

/** One learner with the given scores at cuts 1..n (or at explicit indexes). */
const learnerOf = (
  userId: number,
  scores: number[],
  cuts: number[] = scores.map((_, i) => i + 1),
): SkillGrowthLearner =>
  toSkillGrowthLearners(scores.map((s, i) => row(userId, cuts[i], s)))[0];

/** Deterministic pseudo-random population: 40 learners, 1..9 cuts each. */
const population = (): SkillGrowthLearner[] => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const rows: FoundationalSkillsLearnerCutRow[] = [];
  for (let u = 1; u <= 40; u += 1) {
    const k = 1 + Math.floor(rand() * 9);
    // A quarter climb, a quarter slide, half hold — around per-cut noise.
    const drift = u % 4 === 0 ? 0.25 : u % 4 === 1 ? -0.25 : 0;
    for (let c = 1; c <= k; c += 1) {
      // Every fifth learner has a failed cut 3 — a gap in the cut indexes.
      if (u % 5 === 0 && c === 3) continue;
      const score = Math.min(
        4,
        Math.max(1, 2.5 + drift * c + (rand() - 0.5) / 2),
      );
      rows.push(row(u, c, Math.round(score * 100) / 100));
    }
  }
  return toSkillGrowthLearners(rows);
};

describe('toSkillGrowthLearners', () => {
  it('folds rows into one ascending series per learner and keeps the cut context', () => {
    const [l] = toSkillGrowthLearners([
      row(1, 2, 2.5, { sessionIds: ['b', 'c'], tenantId: null }),
      row(1, 1, 2, {
        verdicts: [{ skill: 'empathy', observed: ['empathy.b1'] }],
      }),
    ]);
    expect(l.cuts.map((c) => c.cut)).toEqual([1, 2]);
    expect(l.cuts[0].observed.has('empathy.b1')).toBe(true);
    expect(l.cuts[1].sessionIds).toEqual(['b', 'c']);
    expect(l.cuts[1].closedAt).toBeInstanceOf(Date);
    // A null tenant on a later row does not erase the one already seen.
    expect(l.tenantId).toBe('org-a');
  });
});

describe('percentileCont', () => {
  it('interpolates exactly as Postgres percentile_cont does', () => {
    const xs = [1, 2, 3, 4];
    expect(percentileCont(xs, 0.5)).toBe(2.5);
    expect(percentileCont(xs, 0.25)).toBe(1.75);
    expect(percentileCont(xs, 0.75)).toBe(3.25);
    expect(percentileCont([3], 0.25)).toBe(3);
    expect(percentileCont([], 0.5)).toBeNull();
  });
});

describe('buildSkillGrowthCurve', () => {
  it('indexes by cut, so a failed cut leaves a gap rather than renumbering', () => {
    // Learner 1 lost cut 3 to a scoring failure: absent at ordinal 3, present
    // at ordinal 4 with their cut-4 score.
    const learners = [
      learnerOf(1, [1.5, 2, 3], [1, 2, 4]),
      learnerOf(2, [2, 2, 2, 2]),
    ];
    const curve = buildSkillGrowthCurve(learners, 1);
    expect(curve.ordinals[2].all).toEqual({
      median: 2,
      p25: 2,
      p75: 2,
      n: 1,
    });
    expect(curve.ordinals[3].all.n).toBe(2);
    expect(curve.ordinals[3].all.median).toBe(2.5);
  });

  it('completes the axis to the max ordinal with n = 0 and null percentiles', () => {
    const curve = buildSkillGrowthCurve([learnerOf(1, [2, 3])], 1);
    expect(curve.ordinals.map((o) => o.ordinal)).toEqual(
      Array.from({ length: SKILL_GROWTH_MAX_ORDINAL }, (_, i) => i + 1),
    );
    expect(curve.ordinals[5].all).toEqual({
      median: null,
      p25: null,
      p75: null,
      n: 0,
    });
  });

  it('withholds a thin cell but keeps its n, and keeps 2 dp on the 1–4 scale', () => {
    const learners = [1, 2, 3].map((u) => learnerOf(u, [2 + u / 3, 3]));
    const curve = buildSkillGrowthCurve(learners, 3);
    // Ordinal 1: 2.333, 2.667, 3 → median 2.67, both quartiles interpolated.
    expect(curve.ordinals[0].all).toEqual({
      median: 2.67,
      p25: 2.5,
      p75: 2.83,
      n: 3,
    });
    const thin = buildSkillGrowthCurve(learners, 4).ordinals[0].all;
    expect(thin).toEqual({ median: null, p25: null, p75: null, n: 3 });
  });

  it('makes "experienced" a property of the person: scored cuts, not the highest index', () => {
    const scored6WithGap = learnerOf(1, [2, 2, 2, 2, 2, 2], [1, 2, 3, 5, 6, 7]);
    // Reached cut 7 but only 5 cuts are scored: NOT experienced.
    const scored5 = learnerOf(2, [3, 3, 3, 3, 3], [1, 2, 3, 6, 7]);
    const curve = buildSkillGrowthCurve([scored6WithGap, scored5], 1);

    expect(SKILL_GROWTH_EXPERIENCED_MIN_CUTS).toBe(6);
    expect(curve.experiencedLearners).toBe(1);
    expect(curve.ordinals[0].all.n).toBe(2);
    expect(curve.ordinals[0].experienced).toEqual({
      median: 2,
      p25: 2,
      p75: 2,
      n: 1,
    });
    expect(curve.scoredCuts).toBe(11);
    expect(curve.learners).toBe(2);
  });

  it('reads the headline off the last ordinal that clears the floor', () => {
    const learners = [
      learnerOf(1, [1.5, 2, 2.5]),
      learnerOf(2, [2, 2.5]),
      learnerOf(3, [2.5, 3]),
    ];
    const curve = buildSkillGrowthCurve(learners, 2);
    expect(curve.firstOrdinalMedian).toBe(2);
    expect(curve.lastComparableOrdinal).toBe(2);
    expect(curve.lastComparableMedian).toBe(2.5);

    const none = buildSkillGrowthCurve(learners, 10);
    expect(none.firstOrdinalMedian).toBeNull();
    expect(none.lastComparableOrdinal).toBeNull();
  });
});

describe('classifySkillGrowthLearner', () => {
  const noise = 0.2; // band at w = 2: 1.96 × 0.2 × √1 = 0.392

  it('compares the first half of ALL scored cuts with the last half', () => {
    const c = classifySkillGrowthLearner(
      learnerOf(1, [2, 2, 2.5, 3, 3]),
      noise,
    );
    // k = 5, w = 2: first (2, 2) vs last (3, 3).
    expect(c).toMatchObject({
      scoredCuts: 5,
      firstWindowMean: 2,
      lastWindowMean: 3,
      delta: 1,
      band: 0.39,
      trend: 'improving',
    });
  });

  it('calls a change inside the noise band flat, and below it declining', () => {
    expect(
      classifySkillGrowthLearner(learnerOf(1, [2, 2, 2.2, 2.2]), noise).trend,
    ).toBe('flat');
    expect(
      classifySkillGrowthLearner(learnerOf(1, [3, 3, 2, 2]), noise).trend,
    ).toBe('declining');
  });

  it('withholds means and delta below trendMinCuts or without a noise estimate', () => {
    const early = classifySkillGrowthLearner(learnerOf(1, [2, 3, 4]), noise);
    expect(early).toMatchObject({
      trend: 'insufficient',
      firstWindowMean: null,
      lastWindowMean: null,
      delta: null,
      band: null,
      classifiedAt: null,
    });
    // learnerTrend reports a change for k >= 2; it is not shown here.
    expect(learnerTrend(learnerOf(1, [2, 3, 4]), noise).change).not.toBeNull();

    const noNoise = classifySkillGrowthLearner(
      learnerOf(1, [2, 2, 3, 3]),
      null,
    );
    expect(noNoise.trend).toBe('insufficient');
  });

  it('dates classifiability by the 4th SCORED cut, gaps included', () => {
    const l = learnerOf(1, [2, 2, 3, 3], [1, 2, 4, 5]);
    const c = classifySkillGrowthLearner(l, noise);
    expect(FHS_PROGRESS_THRESHOLDS.trendMinCuts).toBe(4);
    expect(c.classifiedAt).toEqual(l.cuts[3].closedAt);
    expect(l.cuts[3].cut).toBe(5);
    expect(c.lastCutAt).toEqual(l.cuts[3].closedAt);
  });

  it('is learnerTrend, class for class, across a whole population', () => {
    const learners = population();
    const n = cutNoiseSd(learners);
    expect(n).not.toBeNull();
    for (const l of learners) {
      const expected = learnerTrend(l, n);
      const got = classifySkillGrowthLearner(l, n);
      expect(got.trend).toBe(
        SKILL_TREND_CLASS_BY_LEARNER_TREND[expected.trend],
      );
      if (got.trend !== 'insufficient') {
        expect(got.delta).toBe(
          Math.round((expected.change as number) * 100) / 100,
        );
        expect(got.band).toBe(
          Math.round((expected.band as number) * 100) / 100,
        );
      }
    }
  });
});

describe('buildSkillTrendMix', () => {
  it('equals the Helping skills tab trend counts for the same population', () => {
    const learners = population();
    const noise = cutNoiseSd(learners);
    const mix = buildSkillTrendMix(
      learners.map((l) => classifySkillGrowthLearner(l, noise)),
    );
    const helping = computeProgress(learners, {
      sampleFloor: 20,
      minCohort: 5,
    }).trend;
    // The fixture is only a test if every class is present.
    expect(helping.improving).toBeGreaterThan(0);
    expect(helping.steady).toBeGreaterThan(0);
    expect(helping.declining).toBeGreaterThan(0);
    expect(helping.tooEarly).toBeGreaterThan(0);

    expect(mix.improving).toBe(helping.improving);
    expect(mix.flat).toBe(helping.steady);
    expect(mix.declining).toBe(helping.declining);
    expect(mix.insufficientLearners).toBe(helping.tooEarly);
    expect(mix.classifiedLearners + mix.insufficientLearners).toBe(
      learners.length,
    );
    // Each classified learner sits in exactly one month.
    const inMonths = mix.months.reduce(
      (a, m) => a + m.improving + m.flat + m.declining,
      0,
    );
    expect(inMonths).toBe(mix.classifiedLearners);
  });

  it('buckets by the UTC month of the cut that made them classifiable', () => {
    const at = (iso: string) => ({ closedAt: new Date(iso) });
    const july = toSkillGrowthLearners(
      [2, 2, 3, 3].map((s, i) =>
        row(1, i + 1, s, at(`2026-07-0${i + 1}T10:00:00Z`)),
      ),
    )[0];
    // 4th cut closes on 31 Aug 23:30 UTC — August, whatever the server's zone.
    const aug = toSkillGrowthLearners(
      [3, 3, 2, 2].map((s, i) =>
        row(2, i + 1, s, at(i === 3 ? '2026-08-31T23:30:00Z' : '2026-08-01Z')),
      ),
    )[0];
    const mix = buildSkillTrendMix([
      classifySkillGrowthLearner(july, 0.2),
      classifySkillGrowthLearner(aug, 0.2),
      classifySkillGrowthLearner(learnerOf(3, [2]), 0.2),
    ]);
    expect(mix.months).toEqual([
      { month: '2026-07', improving: 1, flat: 0, declining: 0 },
      { month: '2026-08', improving: 0, flat: 0, declining: 1 },
    ]);
    expect(mix.insufficientLearners).toBe(1);
  });
});

describe('skillTrendThresholds', () => {
  it('echoes the noise and the band at the classification minimum', () => {
    const t = skillTrendThresholds(0.2134);
    expect(t.minSessions).toBe(FHS_PROGRESS_THRESHOLDS.trendMinCuts);
    expect(t.window).toBe(2);
    expect(t.cutNoiseSd).toBe(0.213);
    expect(t.flatBand).toBe(Math.round(learnerBand(0.2134, 2) * 100) / 100);
    expect(t.bandZ).toBe(FHS_PROGRESS_THRESHOLDS.learnerBandZ);
    expect(t.bandRule).toContain('floor(k / 2)');
  });

  it('returns null bands, never 0, when the noise cannot be estimated', () => {
    const t = skillTrendThresholds(null);
    expect(t.flatBand).toBeNull();
    expect(t.cutNoiseSd).toBeNull();
  });
});

describe('sortSkillGrowthLearners', () => {
  const noise = 0.2;
  const rows = [
    learnerOf(3, [2, 2, 3, 3]), // +1
    learnerOf(1, [2]), // insufficient, delta null
    learnerOf(2, [3, 3, 2, 2]), // −1
    learnerOf(4, [2, 2, 3, 3]), // +1, ties with learner 3
  ].map((learner) => ({
    learner,
    classification: classifySkillGrowthLearner(learner, noise),
  }));

  it('sorts by own change with nulls last either way and id as the tiebreak', () => {
    const ids = (desc: boolean) =>
      sortSkillGrowthLearners(rows, 'delta', desc).map((r) => r.learner.userId);
    expect(ids(true)).toEqual([3, 4, 2, 1]);
    expect(ids(false)).toEqual([2, 3, 4, 1]);
  });

  it('sorts by scored cuts and by latest cut', () => {
    expect(
      sortSkillGrowthLearners(rows, 'evaluatedSessions', true).map(
        (r) => r.learner.userId,
      ),
    ).toEqual([2, 3, 4, 1]);
    expect(
      sortSkillGrowthLearners(rows, 'lastSessionAt', false)[0].learner.userId,
    ).toBe(1);
  });
});

describe('cutScenarioTitle', () => {
  const scenarios = new Map([
    ['a', { scenarioTitle: 'Grief' }],
    ['b', { scenarioTitle: 'Exam stress' }],
    ['c', { scenarioTitle: 'Grief' }],
    ['d', { scenarioTitle: null }],
  ]);

  it('joins distinct titles in practice order', () => {
    expect(cutScenarioTitle(['a', 'b', 'c'], scenarios)).toBe(
      'Grief · Exam stress',
    );
    expect(cutScenarioTitle(['c'], scenarios)).toBe('Grief');
  });

  it('is null when nothing resolves', () => {
    expect(cutScenarioTitle(['d', 'zz'], scenarios)).toBeNull();
    expect(cutScenarioTitle([], scenarios)).toBeNull();
  });
});
