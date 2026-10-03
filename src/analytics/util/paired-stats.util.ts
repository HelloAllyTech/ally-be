/**
 * Small-sample statistics for "did the same people change?" questions.
 *
 * Every learning chart on the Skills sub-tab compares a learner with
 * themselves, at n in the tens. At that size an average with no interval
 * reads as a result whatever it is, so these helpers put an honest interval
 * and a test beside every paired change:
 *
 *  - a paired **bootstrap CI** of the mean change, DETERMINISTIC (seeded
 *    PRNG) so the same data always draws the same interval — a chart that
 *    wobbles on refresh would read as data moving;
 *  - an exact two-sided **sign test** on ups vs downs (ties dropped), which
 *    assumes nothing about the shape of the changes;
 *  - **Benjamini–Hochberg** q-values, for when one chart tests ~100
 *    behaviours at once and the biggest few movers are otherwise just the
 *    luckiest draws;
 *  - the **minimum detectable change** at a given n, so a flat line can be
 *    read as "smaller than X, or not there" rather than "nothing happened".
 */

/** mulberry32: tiny, fast, seedable. Not for crypto — for reproducible resampling. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BOOTSTRAP_RESAMPLES = 4000;
export const BOOTSTRAP_SEED = 1;

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * 95% percentile bootstrap CI of the mean of `diffs` (each learner's own
 * change). Null below 2 values — an interval from one person is not one.
 */
export function bootstrapMeanCi(
  diffs: readonly number[],
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): [number, number] | null {
  const n = diffs.length;
  if (n < 2) return null;
  const rand = seededRandom(seed);
  const means = new Array<number>(resamples);
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += diffs[Math.floor(rand() * n)];
    means[r] = sum / n;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * (resamples - 1))];
  const hi = means[Math.ceil(0.975 * (resamples - 1))];
  return [lo, hi];
}

/** log of n choose k, via lgamma-free summation (n is small here). */
function logChoose(n: number, k: number): number {
  let s = 0;
  for (let i = 1; i <= k; i += 1) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * Exact two-sided sign test p-value for `up` successes vs `down` failures
 * under p = 0.5. Ties are the caller's to drop. Null when there is nothing to
 * test (no non-tied pairs).
 */
export function signTestP(up: number, down: number): number | null {
  const n = up + down;
  if (n === 0) return null;
  const k = Math.min(up, down);
  let tail = 0;
  for (let i = 0; i <= k; i += 1)
    tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

export interface PairedChange {
  n: number;
  meanChange: number | null;
  ci: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  /** True only when the CI excludes zero: the change is distinguishable from noise. */
  detectable: boolean;
}

/** Everything a chart needs to say whether a paired change is real. */
export function pairedChange(diffs: readonly number[]): PairedChange {
  const eps = 1e-9;
  const up = diffs.filter((d) => d > eps).length;
  const down = diffs.filter((d) => d < -eps).length;
  const ci = bootstrapMeanCi(diffs);
  return {
    n: diffs.length,
    meanChange: diffs.length ? mean(diffs) : null,
    ci,
    up,
    down,
    tied: diffs.length - up - down,
    signP: signTestP(up, down),
    detectable: !!ci && (ci[0] > 0 || ci[1] < 0),
  };
}

/**
 * Benjamini–Hochberg adjusted q-values, in the input order. Nulls pass
 * through (an untestable item is not counted in the family).
 */
export function benjaminiHochberg(
  ps: readonly (number | null)[],
): (number | null)[] {
  const tested = ps
    .map((p, i) => ({ p, i }))
    .filter((x): x is { p: number; i: number } => x.p !== null)
    .sort((a, b) => a.p - b.p);
  const m = tested.length;
  const q = new Array<number | null>(ps.length).fill(null);
  let running = 1;
  for (let r = m - 1; r >= 0; r -= 1) {
    running = Math.min(running, (tested[r].p * m) / (r + 1));
    q[tested[r].i] = running;
  }
  return q;
}

/**
 * Smallest mean paired change detectable at 80% power, two-sided α = 0.05,
 * given the SD of individual changes and n: (1.96 + 0.84) · sd / √n.
 */
export function minimumDetectableChange(
  sdOfChanges: number,
  n: number,
): number | null {
  if (n < 2 || !Number.isFinite(sdOfChanges)) return null;
  return ((1.96 + 0.8416) * sdOfChanges) / Math.sqrt(n);
}

/** Population SD; null below 2 values. */
export function sd(xs: readonly number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}
