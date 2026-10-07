import { compareArms, earlyStopReason, welchZ } from '../experiment-stats.util';

const OPTIONS = { minSamples: 30, minImprovement: 2 };

describe('welchZ', () => {
  it('is infinite in the direction of the gap when both arms have no variance', () => {
    expect(welchZ({ n: 5, mean: 50, sd: 0 }, { n: 5, mean: 60, sd: 0 })).toBe(
      Infinity,
    );
    expect(welchZ({ n: 5, mean: 50, sd: 0 }, { n: 5, mean: 50, sd: 0 })).toBe(
      0,
    );
  });
});

describe('compareArms', () => {
  it('stays undecided until both arms reach the minimum sample', () => {
    const result = compareArms(
      { n: 30, mean: 60, sd: 10 },
      { n: 29, mean: 90, sd: 5 },
      OPTIONS,
    );
    expect(result.verdict).toBe('undecided');
  });

  it('crowns a challenger that leads by the margin with a significant gap', () => {
    const result = compareArms(
      { n: 40, mean: 60, sd: 10 },
      { n: 30, mean: 70, sd: 10 },
      OPTIONS,
    );
    expect(result.verdict).toBe('challenger_wins');
    expect(result.diff).toBe(10);
  });

  it('does not crown a significant lead smaller than the minimum improvement', () => {
    const result = compareArms(
      { n: 400, mean: 60, sd: 2 },
      { n: 400, mean: 61, sd: 2 },
      OPTIONS,
    );
    expect(result.z).toBeGreaterThan(1.645);
    expect(result.verdict).not.toBe('challenger_wins');
  });

  it('does not crown a large lead that is noise', () => {
    const result = compareArms(
      { n: 30, mean: 60, sd: 30 },
      { n: 30, mean: 65, sd: 30 },
      OPTIONS,
    );
    expect(result.verdict).toBe('undecided');
  });

  it('retires a significantly worse challenger', () => {
    const result = compareArms(
      { n: 30, mean: 70, sd: 10 },
      { n: 30, mean: 60, sd: 10 },
      OPTIONS,
    );
    expect(result.verdict).toBe('challenger_loses');
  });

  it('retires a challenger that never separated after twice the sample', () => {
    const result = compareArms(
      { n: 100, mean: 60, sd: 30 },
      { n: 60, mean: 62, sd: 30 },
      OPTIONS,
    );
    expect(result.verdict).toBe('challenger_loses');
  });
});

describe('earlyStopReason', () => {
  const champion = { n: 40, mean: 70, sd: 10 };

  it('keeps a challenger that is behind but still inside the noise', () => {
    expect(
      earlyStopReason(
        champion,
        { n: 10, mean: 62, sd: 10, formatFailures: 0 },
        30,
      ),
    ).toBeNull();
  });

  it('pulls a challenger that is clearly worse once it has a third of the sample', () => {
    expect(
      earlyStopReason(
        champion,
        { n: 10, mean: 50, sd: 10, formatFailures: 0 },
        30,
      ),
    ).toMatch(/Scoring 50\.0 against the champion's 70\.0/);
  });

  it('waits for the floor before judging a bad start', () => {
    expect(
      earlyStopReason(
        champion,
        { n: 5, mean: 20, sd: 10, formatFailures: 0 },
        30,
      ),
    ).toBeNull();
  });

  it('pulls a challenger that breaks the output format', () => {
    expect(
      earlyStopReason(
        champion,
        { n: 10, mean: 65, sd: 10, formatFailures: 3 },
        30,
      ),
    ).toMatch(/3 of 10 outputs failed/);
  });
});
