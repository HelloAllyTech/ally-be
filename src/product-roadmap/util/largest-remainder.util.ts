/**
 * Split `total` across `weights` so the parts sum to EXACTLY `total` — the largest-remainder
 * (Hamilton) method. A faithful port of the standalone app's
 * `public.largest_remainder_split(int, numeric[])`.
 *
 * Used when an admin splits an opportunity: every contributor's votes on the original are
 * divided across the parts by weight. Exactness matters because the sum of all allocations is
 * the priority signal — a naive round() would leak or invent votes on most inputs, and the
 * error would compound across every (user, period) pair on a busy opportunity.
 *
 * Behaviours deliberately matching the plpgsql:
 *  - negative weights are clamped to 0 (`greatest(p_weights[i], 0)`);
 *  - if all weights are ≤ 0 the whole total goes to the FIRST part, rather than throwing;
 *  - leftover votes go to the largest fractional remainders, ties broken by lowest index
 *    (`ORDER BY rem DESC, ord`).
 *
 * KNOWN, HARMLESS DIVERGENCE: plpgsql used exact `numeric`, this uses IEEE doubles. The sum is
 * exact regardless, because the leftover is derived from the actual floors rather than
 * recomputed. The only reachable difference is which part wins a mathematically exact tie
 * (e.g. 100 split three ways) — one vote may land on a different part than Postgres would have
 * chosen. Both answers are valid Hamilton results, the totals match, and for the integer
 * percentages the split UI produces it is not reachable in practice.
 */
export function largestRemainderSplit(
  total: number,
  weights: number[],
): number[] {
  const n = weights.length;
  if (!n) return [];

  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);

  // Degenerate weights: hand everything to the first part (matches the plpgsql).
  if (sum <= 0) {
    const shares = new Array<number>(n).fill(0);
    shares[0] = total;
    return shares;
  }

  const shares = new Array<number>(n).fill(0);
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;

  for (let i = 0; i < n; i++) {
    const ideal = (total * w[i]) / sum;
    const floored = Math.floor(ideal);
    shares[i] = floored;
    remainders.push({ index: i, remainder: ideal - floored });
    allocated += floored;
  }

  // Largest fractional remainder first; lowest index wins a tie.
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const leftover = total - allocated;
  for (let k = 0; k < leftover; k++) {
    shares[remainders[k % n].index] += 1;
  }

  return shares;
}
