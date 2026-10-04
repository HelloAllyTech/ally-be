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

/** A {@link PairedChange} with the averages either side, ready for a chart. */
export interface FlooredPairedComparison {
  n: number;
  beforeAvg: number | null;
  afterAvg: number | null;
  change: number | null;
  changeCi: [number, number] | null;
  up: number;
  down: number;
  tied: number;
  signP: number | null;
  detectable: boolean;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

/**
 * A paired before/after comparison with a sample floor applied: below `floor`
 * learners every average, interval and test is withheld (null; `detectable`
 * false) while the counts still travel, so a card can say "n = 12 · need 20"
 * instead of a number one learner can swing. `before[i]` and `after[i]` are
 * the same learner. Averages and changes are rounded to 2 dp, the sign-test p
 * to 4.
 */
export function flooredPairedComparison(
  before: readonly number[],
  after: readonly number[],
  floor: number,
): FlooredPairedComparison {
  const n = before.length;
  const stats = pairedChange(after.map((v, i) => v - before[i]));
  const enough = n >= floor;
  return {
    n,
    beforeAvg: enough ? round2(mean(before)) : null,
    afterAvg: enough ? round2(mean(after)) : null,
    change:
      enough && stats.meanChange !== null ? round2(stats.meanChange) : null,
    changeCi:
      enough && stats.ci
        ? ([round2(stats.ci[0]), round2(stats.ci[1])] as [number, number])
        : null,
    up: stats.up,
    down: stats.down,
    tied: stats.tied,
    signP: enough && stats.signP !== null ? round4(stats.signP) : null,
    detectable: enough && stats.detectable,
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

/**
 * ICC(1), one-way random effects: the share of variance in `groups` (one
 * array of observations per person) that belongs to the person rather than to
 * the occasion. Groups with fewer than 2 observations are ignored; null when
 * fewer than 3 groups remain. Clamped at 0 (a negative estimate means "no
 * person signal", not a meaningful negative share).
 */
export function icc1(groups: readonly (readonly number[])[]): number | null {
  const gs = groups.filter((g) => g.length >= 2);
  const g = gs.length;
  const N = gs.reduce((a, x) => a + x.length, 0);
  if (g < 3 || N <= g) return null;
  const grand = gs.reduce((a, x) => a + x.reduce((s, v) => s + v, 0), 0) / N;
  const means = gs.map((x) => x.reduce((s, v) => s + v, 0) / x.length);
  const ssb = gs.reduce((a, x, i) => a + x.length * (means[i] - grand) ** 2, 0);
  const ssw = gs.reduce(
    (a, x, i) => a + x.reduce((s, v) => s + (v - means[i]) ** 2, 0),
    0,
  );
  const msb = ssb / (g - 1);
  const msw = ssw / (N - g);
  const k0 = (N - gs.reduce((a, x) => a + x.length ** 2, 0) / N) / (g - 1);
  const den = msb + (k0 - 1) * msw;
  if (den <= 0) return null;
  return Math.max(0, (msb - msw) / den);
}

const logFactorial = (n: number): number => {
  let s = 0;
  for (let i = 2; i <= n; i += 1) s += Math.log(i);
  return s;
};

/**
 * Fisher's exact test, two-sided, for a 2×2 table [[a, b], [c, d]] — here
 * "shown / not shown" at the start vs now for one learner and one behaviour,
 * where counts are a handful of slices and a chi-square would be wrong.
 * Null when either row is empty.
 */
export function fisherExactP(
  a: number,
  b: number,
  c: number,
  d: number,
): number | null {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  if (r1 === 0 || r2 === 0) return null;
  const base =
    logFactorial(r1) +
    logFactorial(r2) +
    logFactorial(c1) +
    logFactorial(n - c1) -
    logFactorial(n);
  const prob = (x: number) =>
    Math.exp(
      base -
        logFactorial(x) -
        logFactorial(r1 - x) -
        logFactorial(c1 - x) -
        logFactorial(r2 - c1 + x),
    );
  const observed = prob(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x += 1) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-9)) p += px;
  }
  return Math.min(1, p);
}
