import {
  benjaminiHochberg,
  bootstrapMeanCi,
  fisherExactP,
  icc1,
  minimumDetectableChange,
  pairedChange,
  sd,
  signTestP,
} from '../paired-stats.util';

describe('paired-stats util', () => {
  it('computes exact two-sided sign test p-values', () => {
    expect(signTestP(19, 1)).toBeCloseTo(0.00004, 5);
    expect(signTestP(14, 10)).toBeCloseTo(0.541, 3);
    expect(signTestP(5, 5)).toBe(1);
    expect(signTestP(0, 0)).toBeNull();
  });

  it('draws the same bootstrap interval every time and brackets the mean', () => {
    const diffs = [0.1, -0.2, 0.3, 0.05, -0.1, 0.2, 0, 0.15];
    const a = bootstrapMeanCi(diffs);
    const b = bootstrapMeanCi(diffs);
    expect(a).toEqual(b);
    const m = diffs.reduce((x, y) => x + y) / diffs.length;
    expect(a![0]).toBeLessThan(m);
    expect(a![1]).toBeGreaterThan(m);
    expect(bootstrapMeanCi([0.4])).toBeNull();
  });

  it('calls a change detectable only when its CI excludes zero', () => {
    expect(pairedChange([0.5, 0.6, 0.4, 0.55, 0.45, 0.5]).detectable).toBe(
      true,
    );
    const noise = pairedChange([0.2, -0.2, 0.1, -0.1, 0.05, -0.05]);
    expect(noise.detectable).toBe(false);
    expect(noise).toMatchObject({ n: 6, up: 3, down: 3, tied: 0, signP: 1 });
    expect(pairedChange([]).meanChange).toBeNull();
  });

  it('adjusts p-values with Benjamini-Hochberg, passing nulls through', () => {
    const q = benjaminiHochberg([0.01, 0.04, null, 0.03, 0.5]);
    expect(q[2]).toBeNull();
    expect(q[0]).toBeCloseTo(0.04, 6);
    expect(q[1]).toBeCloseTo(0.0533, 3);
    expect(q[3]).toBeCloseTo(0.0533, 3);
    expect(q[4]).toBeCloseTo(0.5, 6);
  });

  it('sizes the minimum detectable change from the spread of changes', () => {
    expect(minimumDetectableChange(0.18, 24)).toBeCloseTo(0.103, 2);
    expect(minimumDetectableChange(0.18, 1)).toBeNull();
    expect(sd([1, 2, 3])).toBeCloseTo(1, 6);
  });
});

describe('icc1 and fisherExactP', () => {
  it('finds high person signal when people differ consistently, ~0 for pure noise', () => {
    expect(
      icc1([
        [1, 1, 1],
        [0, 0, 0],
        [1, 1, 1],
        [0, 0, 0],
      ]),
    ).toBeCloseTo(1, 6);
    expect(
      icc1([
        [1, 0],
        [0, 1],
        [1, 0],
        [0, 1],
      ]),
    ).toBe(0);
    expect(icc1([[1, 0]])).toBeNull();
  });

  it('computes exact two-sided Fisher p-values', () => {
    // 0/4 at the start vs 4/4 now
    expect(fisherExactP(0, 4, 4, 0)).toBeCloseTo(0.0286, 3);
    expect(fisherExactP(2, 2, 2, 2)).toBeCloseTo(1, 6);
    expect(fisherExactP(0, 0, 3, 1)).toBeNull();
  });
});
