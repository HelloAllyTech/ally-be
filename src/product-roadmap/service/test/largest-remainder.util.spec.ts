import { largestRemainderSplit } from '../../util/largest-remainder.util';

/**
 * The vote-splitting arithmetic. Exactness is the whole point: the sum of all allocations IS
 * the priority signal, so a rounding leak would quietly corrupt the one number the feature
 * exists to produce, and the error would compound across every (user, period) pair on a busy
 * opportunity.
 */
describe('largestRemainderSplit', () => {
  it('matches the plpgsql reference cases', () => {
    // Ported from the standalone app's largest_remainder_split(int, numeric[]).
    expect(largestRemainderSplit(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderSplit(100, [50, 30, 20])).toEqual([50, 30, 20]);
    expect(largestRemainderSplit(7, [1, 1, 1])).toEqual([3, 2, 2]);
    expect(largestRemainderSplit(0, [1, 1])).toEqual([0, 0]);
    expect(largestRemainderSplit(1, [1, 1])).toEqual([1, 0]);
    expect(largestRemainderSplit(5, [1, 0, 4])).toEqual([1, 0, 4]);
  });

  it('hands everything to the first part when all weights are non-positive', () => {
    // Degenerate case, matching the plpgsql rather than throwing — losing the votes would be
    // worse than an arbitrary-but-total assignment.
    expect(largestRemainderSplit(100, [0, 0, 0])).toEqual([100, 0, 0]);
    expect(largestRemainderSplit(10, [-5, -1])).toEqual([10, 0]);
  });

  it('clamps negative weights to zero without losing votes', () => {
    const shares = largestRemainderSplit(10, [-3, 1, 1]);
    expect(shares[0]).toBe(0);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10);
  });

  it('returns an empty array for no parts', () => {
    expect(largestRemainderSplit(50, [])).toEqual([]);
  });

  it('gives leftover votes to the largest remainders, lowest index winning a tie', () => {
    // 10 across [3,3,3]: ideal 3.33 each, floors 3+3+3=9, one leftover to index 0.
    expect(largestRemainderSplit(10, [3, 3, 3])).toEqual([4, 3, 3]);
    // 11 across [3,3,3]: two leftovers to indices 0 and 1.
    expect(largestRemainderSplit(11, [3, 3, 3])).toEqual([4, 4, 3]);
  });

  /**
   * The invariant that matters. 500 randomised cases rather than a handful of examples,
   * because the failure mode is a one-vote drift on unusual weight ratios — exactly what
   * hand-picked cases miss.
   */
  it('conserves votes exactly across 500 randomised splits', () => {
    let checked = 0;
    for (let seed = 0; seed < 500; seed++) {
      // Deterministic pseudo-random, so a failure is reproducible.
      const rand = (n: number, salt: number) =>
        ((seed * 9301 + salt * 49297) % 233280) % n;
      const total = rand(101, 1); // 0..100, the legal vote range
      const partCount = 2 + rand(5, 2); // 2..6 parts
      const weights = Array.from({ length: partCount }, (_, i) =>
        rand(100, i + 3),
      );

      const shares = largestRemainderSplit(total, weights);
      const sum = shares.reduce((a, b) => a + b, 0);

      expect(sum).toBe(total);
      expect(shares).toHaveLength(partCount);
      expect(shares.every((s) => s >= 0 && Number.isInteger(s))).toBe(true);
      checked++;
    }
    expect(checked).toBe(500);
  });

  it('never gives a part more than the total', () => {
    for (let total = 0; total <= 100; total += 7) {
      const shares = largestRemainderSplit(total, [1, 2, 3, 4]);
      expect(Math.max(...shares)).toBeLessThanOrEqual(total);
    }
  });
});
