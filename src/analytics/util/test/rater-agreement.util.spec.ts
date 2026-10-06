import {
  BINARY_CATEGORIES,
  FHS_LEVEL_CATEGORIES,
  MIN_RATED_CUTS_FOR_AGREEMENT,
  RatedPair,
  binaryAgreement,
  cohensKappa,
  confusionMatrix,
  kappaFromMatrix,
  levelAgreement,
  percentAgreement,
} from '../rater-agreement.util';

/** Expand a count matrix back into (row, column) pairs. */
const pairsFrom = (
  m: number[][],
  categories: readonly number[],
): [number, number][] =>
  m.flatMap((row, i) =>
    row.flatMap((count, j) =>
      Array.from(
        { length: count },
        () => [categories[i], categories[j]] as [number, number],
      ),
    ),
  );

describe("Cohen's kappa — textbook examples", () => {
  it('the classic 50-item yes/no example: pₒ 0.7, pₑ 0.5, κ 0.4', () => {
    // A yes/B yes 20, A yes/B no 5, A no/B yes 10, A no/B no 15.
    const m = [
      [15, 10],
      [5, 20],
    ];
    expect(kappaFromMatrix(m)).toBeCloseTo(0.4, 10);
    expect(percentAgreement(pairsFrom(m, BINARY_CATEGORIES))).toBeCloseTo(70);
  });

  it('same agreement, different marginals → different κ (0.1304 vs 0.2593)', () => {
    // Both have pₒ = 0.6; the marginals set pₑ.
    expect(
      kappaFromMatrix([
        [45, 15],
        [25, 15],
      ]),
    ).toBeCloseTo(0.06 / 0.46, 4);
    expect(
      kappaFromMatrix([
        [25, 35],
        [5, 35],
      ]),
    ).toBeCloseTo(0.14 / 0.54, 4);
  });

  it('perfect agreement is 1', () => {
    const pairs: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [2, 2],
    ];
    expect(cohensKappa(pairs, FHS_LEVEL_CATEGORIES)).toBe(1);
    expect(cohensKappa(pairs, FHS_LEVEL_CATEGORIES, 'quadratic')).toBe(1);
  });

  it('agreement no better than chance is 0', () => {
    expect(
      kappaFromMatrix([
        [25, 25],
        [25, 25],
      ]),
    ).toBeCloseTo(0, 10);
  });

  it('systematic disagreement is negative (−1 when every pair flips)', () => {
    expect(
      kappaFromMatrix([
        [0, 10],
        [10, 0],
      ]),
    ).toBeCloseTo(-1, 10);
  });

  it('is undefined (null) when both raters used one and the same category', () => {
    const pairs: [number, number][] = [
      [2, 2],
      [2, 2],
      [2, 2],
    ];
    expect(cohensKappa(pairs, FHS_LEVEL_CATEGORIES)).toBeNull();
    expect(cohensKappa(pairs, FHS_LEVEL_CATEGORIES, 'quadratic')).toBeNull();
    expect(percentAgreement(pairs)).toBe(100);
  });

  it('is null with no pairs', () => {
    expect(cohensKappa([], FHS_LEVEL_CATEGORIES)).toBeNull();
    expect(percentAgreement([])).toBeNull();
  });
});

describe('quadratic-weighted kappa', () => {
  // Hand-worked: pₒ = 0.5, unweighted κ = 1/3. Every disagreement is one level
  // apart, so quadratic weights forgive most of it: κw = 1 − (4/9 ÷ 8) / 0.25 = 7/9.
  const pairs: [number, number][] = [
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 3],
  ];

  it('unweighted κ treats a near miss like a far one', () => {
    expect(cohensKappa(pairs, FHS_LEVEL_CATEGORIES)).toBeCloseTo(1 / 3, 10);
  });

  it('weighted κ credits one-level disagreements on an ordinal scale', () => {
    expect(cohensKappa(pairs, FHS_LEVEL_CATEGORIES, 'quadratic')).toBeCloseTo(
      7 / 9,
      10,
    );
  });

  it('weighted κ punishes far misses harder than unweighted', () => {
    // Same diagonal, but the misses are 1 ↔ 4.
    const far: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [1, 4],
      [4, 1],
      [1, 4],
      [4, 1],
    ];
    const unweighted = cohensKappa(far, FHS_LEVEL_CATEGORIES)!;
    const weighted = cohensKappa(far, FHS_LEVEL_CATEGORIES, 'quadratic')!;
    expect(weighted).toBeLessThan(unweighted);
  });

  it('equals unweighted κ for two categories', () => {
    const m = [
      [15, 10],
      [5, 20],
    ];
    expect(kappaFromMatrix(m, 'quadratic')).toBeCloseTo(kappaFromMatrix(m)!);
  });
});

describe('confusionMatrix', () => {
  it('counts rows = first rater, columns = second, ignoring unknown categories', () => {
    expect(
      confusionMatrix(
        [
          [1, 2],
          [1, 2],
          [4, 4],
          [5, 1],
        ],
        FHS_LEVEL_CATEGORIES,
      ),
    ).toEqual([
      [0, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]);
  });
});

describe('floored summaries', () => {
  const cutsOf = (n: number, perCut: [number, number][]): RatedPair[] =>
    Array.from({ length: n }, (_, i) =>
      perCut.map(([a, b]) => ({ cutId: `cut-${i}`, a, b })),
    ).flat();

  it('withholds κ, % and the mean difference below the floor; counts travel', () => {
    const pairs = cutsOf(MIN_RATED_CUTS_FOR_AGREEMENT - 1, [[3, 2]]);
    const out = levelAgreement(pairs);
    expect(out).toMatchObject({
      pairs: 19,
      cuts: 19,
      kappa: null,
      weightedKappa: null,
      exactAgreementPct: null,
      meanDifference: null,
    });
    expect(out.confusion[2][1]).toBe(19);
  });

  it('counts the floor in distinct CUTS, not pairs', () => {
    // 10 cuts × 3 raters each = 30 pairs, still only 10 cuts.
    const pairs = cutsOf(10, [
      [3, 3],
      [3, 2],
      [2, 2],
    ]);
    const out = levelAgreement(pairs);
    expect(out.pairs).toBe(30);
    expect(out.cuts).toBe(10);
    expect(out.kappa).toBeNull();
  });

  it('reports κ, weighted κ, % exact and judge − human at the floor', () => {
    const pairs = [
      ...cutsOf(10, [[3, 3]]),
      ...cutsOf(10, [[2, 2]]).map((p) => ({ ...p, cutId: `${p.cutId}-b` })),
      ...cutsOf(5, [[3, 2]]).map((p) => ({ ...p, cutId: `${p.cutId}-c` })),
    ];
    const out = levelAgreement(pairs);
    expect(out.cuts).toBe(25);
    expect(out.exactAgreementPct).toBe(80);
    expect(out.meanDifference).toBe(0.2);
    expect(out.kappa).not.toBeNull();
    expect(out.weightedKappa).not.toBeNull();
  });

  it('drops the mean difference when the comparison has no direction', () => {
    const pairs = cutsOf(25, [[3, 2]]).concat(
      cutsOf(5, [[2, 2]]).map((p) => ({ ...p, cutId: `${p.cutId}-x` })),
    );
    expect(levelAgreement(pairs, { directional: false }).meanDifference).toBe(
      null,
    );
  });

  it('binary agreement splits the four cells and floors κ and %', () => {
    const pairs: RatedPair[] = [
      { cutId: 'a', a: 1, b: 1 },
      { cutId: 'b', a: 1, b: 0 },
      { cutId: 'c', a: 0, b: 1 },
      { cutId: 'd', a: 0, b: 0 },
    ];
    expect(binaryAgreement(pairs)).toEqual({
      pairs: 4,
      cuts: 4,
      kappa: null,
      agreementPct: null,
      both: 1,
      onlyFirst: 1,
      onlySecond: 1,
      neither: 1,
    });
    expect(binaryAgreement(pairs, { minCuts: 4 })).toMatchObject({
      kappa: 0,
      agreementPct: 50,
    });
  });
});
