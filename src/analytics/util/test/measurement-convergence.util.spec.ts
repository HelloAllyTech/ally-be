import {
  CONVERGENCE_RULERS,
  ConvergenceCut,
  ConvergenceSessionSignals,
  MIN_PAIRS_FOR_CONVERGENCE,
  VersionScoreStats,
  averageRanks,
  buildConvergence,
  cutRulerValues,
  meanSkillCoverage,
  scoreZ,
  singleScenarioOf,
  spearman,
  versionKey,
} from '../measurement-convergence.util';

const session = (
  over: Partial<ConvergenceSessionSignals> = {},
): ConvergenceSessionSignals => ({
  scenarioId: 7,
  versionId: 'v-1',
  score: 10,
  scoreEligible: true,
  doHits: 0,
  dontHits: 0,
  skillCoverage: null,
  rating: null,
  ...over,
});

const STATS: VersionScoreStats = { sessions: 10, mean: 10, sd: 5 };

describe('averageRanks', () => {
  it('gives tied values the average of the ranks they span', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(averageRanks([3, 1, 2])).toEqual([3, 1, 2]);
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2]);
  });
});

describe('spearman', () => {
  it('is 1 for any increasing relation and −1 for a decreasing one', () => {
    expect(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 25])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it('handles ties with average ranks (Pearson on ranks, not the d² shortcut)', () => {
    // rx = 1..5, ry = [1, 2.5, 2.5, 4, 5] → 9.5 / √(10 · 9.5).
    expect(spearman([1, 2, 3, 4, 5], [1, 2, 2, 4, 5])).toBeCloseTo(
      9.5 / Math.sqrt(95),
      10,
    );
  });

  it('is null below two pairs or when either side is constant', () => {
    expect(spearman([1], [2])).toBeNull();
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNull();
    expect(spearman([1, 2], [1])).toBeNull();
  });
});

describe('scoreZ', () => {
  it('z-scores an eligible session within its version', () => {
    expect(scoreZ(session({ score: 20 }), STATS)).toBe(2);
    expect(scoreZ(session({ score: 5 }), STATS)).toBe(-1);
  });

  it('skips versions with fewer than 5 sessions or no spread', () => {
    expect(scoreZ(session(), { sessions: 4, mean: 10, sd: 5 })).toBeNull();
    expect(scoreZ(session(), { sessions: 9, mean: 10, sd: 0 })).toBeNull();
    expect(scoreZ(session(), { sessions: 9, mean: 10, sd: null })).toBeNull();
    expect(scoreZ(session(), undefined)).toBeNull();
  });

  it('never z-scores an ineligible score (the unresolved 0, or uncountable)', () => {
    expect(
      scoreZ(session({ score: 0, scoreEligible: false }), STATS),
    ).toBeNull();
    expect(scoreZ(session({ score: null }), STATS)).toBeNull();
  });
});

describe('meanSkillCoverage', () => {
  it('averages whatever categories are present, across both label generations', () => {
    expect(
      meanSkillCoverage([
        { category: 'Empathy', percentage: 80 },
        { category: 'active_listening', percentage: '60' },
      ]),
    ).toBe(70);
  });

  it('drops anything that is not a {category, percentage} pair', () => {
    expect(
      meanSkillCoverage([
        { category: 'Empathy', percentage: 90 },
        { percentage: 10 },
        { category: 'x', percentage: 'n/a' },
        null,
        'junk',
      ]),
    ).toBe(90);
    expect(meanSkillCoverage([])).toBeNull();
    expect(meanSkillCoverage({ category: 'x', percentage: 1 })).toBeNull();
    expect(meanSkillCoverage(null)).toBeNull();
  });
});

describe('singleScenarioOf', () => {
  const sessions = new Map([
    ['a', session({ scenarioId: 1 })],
    ['b', session({ scenarioId: 1 })],
    ['c', session({ scenarioId: 2 })],
    ['d', session({ scenarioId: null })],
  ]);
  const cut = (ids: string[]): ConvergenceCut => ({
    userId: 1,
    score: 2,
    sessionIds: ids,
  });

  it('is the scenario when every session ran the same one', () => {
    expect(singleScenarioOf(cut(['a']), sessions)).toBe(1);
    expect(singleScenarioOf(cut(['a', 'b']), sessions)).toBe(1);
  });

  it('is null for a mixed cut, a missing session or no sessions', () => {
    expect(singleScenarioOf(cut(['a', 'c']), sessions)).toBeNull();
    expect(singleScenarioOf(cut(['a', 'zzz']), sessions)).toBeNull();
    expect(singleScenarioOf(cut(['d']), sessions)).toBeNull();
    expect(singleScenarioOf(cut([]), sessions)).toBeNull();
  });
});

describe('cutRulerValues', () => {
  it('derives one value per ruler over the cut’s sessions', () => {
    const sessions = new Map([
      [
        'a',
        session({
          score: 20,
          doHits: 3,
          dontHits: 1,
          skillCoverage: [{ category: 'x', percentage: 40 }],
          rating: 4,
        }),
      ],
      [
        'b',
        session({
          score: 0,
          scoreEligible: false,
          doHits: 1,
          dontHits: 3,
          skillCoverage: [{ category: 'y', percentage: 80 }],
          rating: null,
        }),
      ],
    ]);
    const stats = new Map([[versionKey(7, 'v-1'), STATS]]);
    const v = cutRulerValues(
      { userId: 1, score: 2.5, sessionIds: ['a', 'b', 'a'] },
      sessions,
      stats,
    );
    expect(v).toEqual({
      R1: 2.5,
      R2: 2, // only the eligible session's z
      R3: 0, // pooled: (4 − 4) / 8
      R4: 60,
      R6: 4,
    });
  });

  it('is null where a ruler has nothing to say (no hits, no coverage, no rating)', () => {
    const v = cutRulerValues(
      { userId: 1, score: 3, sessionIds: ['a'] },
      new Map([['a', session()]]),
      new Map(),
    );
    expect(v).toEqual({ R1: 3, R2: null, R3: null, R4: null, R6: null });
  });

  it('keys NULL-version sessions as their own group', () => {
    expect(versionKey(7, null)).toBe('7:none');
    const v = cutRulerValues(
      { userId: 1, score: 3, sessionIds: ['a'] },
      new Map([['a', session({ versionId: null, score: 15 })]]),
      new Map([[versionKey(7, null), STATS]]),
    );
    expect(v.R2).toBe(1);
  });
});

describe('buildConvergence', () => {
  /**
   * `n` single-scenario cuts, each with its own session. R2 rises with R1,
   * R6 falls with it, R3 is constant, R4 is absent.
   */
  const fixture = (n: number) => {
    const cuts: ConvergenceCut[] = [];
    const sessions = new Map<string, ConvergenceSessionSignals>();
    for (let i = 0; i < n; i += 1) {
      const id = `s${i}`;
      cuts.push({ userId: i % 7, score: 1 + i / n, sessionIds: [id] });
      sessions.set(
        id,
        session({ score: i, doHits: 1, dontHits: 0, rating: 5 - i / n }),
      );
    }
    const stats = new Map([
      [versionKey(7, 'v-1'), { sessions: n, mean: n / 2, sd: 3 }],
    ]);
    return { cuts, sessions, stats };
  };

  it('echoes the rulers in matrix order and every pair once', () => {
    const out = buildConvergence(fixture(60));
    expect(out.rulers.map((r) => r.key)).toEqual(
      CONVERGENCE_RULERS.map((r) => r.key),
    );
    expect(out.pairs.map((p) => `${p.a}-${p.b}`)).toEqual([
      'R1-R2',
      'R1-R3',
      'R1-R4',
      'R1-R6',
      'R2-R3',
      'R2-R4',
      'R2-R6',
      'R3-R4',
      'R3-R6',
      'R4-R6',
    ]);
    expect(out.rulers.find((r) => r.key === 'R4')?.cuts).toBe(0);
  });

  it('shows r with its n and learners at or above the floor', () => {
    const out = buildConvergence(fixture(60));
    const pair = (a: string, b: string) =>
      out.pairs.find((p) => p.a === a && p.b === b)!;
    expect(pair('R1', 'R2')).toEqual({
      a: 'R1',
      b: 'R2',
      n: 60,
      learners: 7,
      r: 1,
    });
    expect(pair('R1', 'R6').r).toBe(-1);
    // A constant ruler has no order to agree with.
    expect(pair('R1', 'R3')).toMatchObject({ n: 60, r: null });
    // An absent ruler pairs with nothing.
    expect(pair('R1', 'R4')).toMatchObject({ n: 0, learners: 0, r: null });
    expect(out.strongest).toMatchObject({ a: 'R1', b: 'R2', r: 1 });
    expect(out.weakest).toMatchObject({ r: -1 });
  });

  it('withholds r below MIN_PAIRS_FOR_CONVERGENCE while n travels', () => {
    expect(MIN_PAIRS_FOR_CONVERGENCE).toBe(50);
    const out = buildConvergence(fixture(49));
    const r12 = out.pairs.find((p) => p.a === 'R1' && p.b === 'R2')!;
    expect(r12.n).toBe(49);
    expect(r12.r).toBeNull();
    expect(out.strongest).toBeNull();
    expect(out.weakest).toBeNull();
  });

  it('compares single-scenario cuts only and reports the share', () => {
    const f = fixture(60);
    f.sessions.set('other', session({ scenarioId: 99 }));
    f.cuts.push({ userId: 1, score: 4, sessionIds: ['s0', 'other'] });
    f.cuts.push({ userId: 1, score: 4, sessionIds: ['missing'] });
    const out = buildConvergence(f);
    expect(out.cuts).toEqual({
      total: 62,
      singleScenario: 60,
      singleScenarioPct: 96.8,
    });
    expect(out.pairs[0].n).toBe(60);
  });

  it('is empty, not broken, with no cuts', () => {
    const out = buildConvergence({
      cuts: [],
      sessions: new Map(),
      stats: new Map(),
    });
    expect(out.cuts).toEqual({
      total: 0,
      singleScenario: 0,
      singleScenarioPct: null,
    });
    expect(out.pairs.every((p) => p.n === 0 && p.r === null)).toBe(true);
    expect(out.strongest).toBeNull();
  });

  it('breaks an r tie towards the cell with more pairs', () => {
    const f = fixture(60);
    // R4 present on 55 cuts, rising with R1 like R2 (r = 1 on fewer pairs).
    f.cuts.slice(0, 55).forEach((c, i) => {
      const s = f.sessions.get(c.sessionIds[0])!;
      f.sessions.set(c.sessionIds[0], {
        ...s,
        skillCoverage: [{ category: 'x', percentage: i }],
      });
    });
    const out = buildConvergence(f);
    expect(out.pairs.find((p) => p.a === 'R1' && p.b === 'R4')).toMatchObject({
      n: 55,
      r: 1,
    });
    expect(out.strongest).toMatchObject({ a: 'R1', b: 'R2', n: 60 });
  });
});
