import { BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED } from './paired-stats.util';
import {
  LearnerTrend,
  ProgressLearner,
  cutNoiseSd,
  learnerTrend,
} from './foundational-skills-progress.util';

/**
 * Dose–response (EFF-04, AAQ-217): do learners who practise more improve more?
 *
 * One point per learner whose own trend the Helping skills tab can classify —
 * x = how much they practised (scored cuts, or minutes), y = their own
 * first-half vs last-half composite change, the quantity behind AAQ-171 — and a
 * least-squares line through the points with a bootstrap CI on its slope.
 *
 * Deliberately NOT banded. AAQ-182 ("change by practice volume" in bands) was
 * retired because three of its four bands sat below the sample floor; a fitted
 * slope uses every learner at once, so it needs one population gate
 * ({@link DOSE_RESPONSE_MIN_LEARNERS}) instead of a floor per band.
 *
 * Pure functions, so the gate, the fit and the bootstrap are unit-tested
 * without a database.
 */

/**
 * Classified learners the scatter and its fit need before either is shown.
 *
 * Forty, not the platform's 20-per-average floor: a slope is a comparison
 * across people, which needs more of them than a mean of one group, and at
 * ~20 points one prolific learner sets the line. Below it the card says
 * "not yet measurable — n = 12 of 40 needed" rather than drawing a scatter a
 * reader would fit by eye.
 */
export const DOSE_RESPONSE_MIN_LEARNERS = 40;

/**
 * Below this share of usable resamples the slope CI is withheld: when most
 * resamples draw learners who all practised the same amount, x has no spread
 * and the slopes that remain are not a fair sample of the uncertainty.
 */
const MIN_VALID_RESAMPLE_SHARE = 0.95;

/** mulberry32 — the same seeded PRNG `paired-stats.util` resamples with. */
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

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface LinearFit {
  slope: number;
  intercept: number;
}

/**
 * Ordinary least squares of `ys` on `xs`. Null below two points or when x has
 * no spread (every learner practised the same amount: no slope exists).
 */
export function leastSquares(
  xs: readonly number[],
  ys: readonly number[],
): LinearFit | null {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i] - my);
  }
  if (sxx <= 1e-12) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/**
 * 95% percentile bootstrap CI of the least-squares slope, resampling
 * LEARNERS (each (x, y) pair is one person, drawn with replacement) — so the
 * interval is over people, never over rows. DETERMINISTIC: the same seeded
 * PRNG as `bootstrapMeanCi`, so the same data always draws the same interval.
 *
 * Null below three points, or when fewer than 95% of resamples have any
 * spread in x (see {@link MIN_VALID_RESAMPLE_SHARE}).
 */
export function bootstrapSlopeCi(
  xs: readonly number[],
  ys: readonly number[],
  resamples = BOOTSTRAP_RESAMPLES,
  seed = BOOTSTRAP_SEED,
): [number, number] | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const rand = seededRandom(seed);
  const slopes: number[] = [];
  const bx = new Array<number>(n);
  const by = new Array<number>(n);
  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < n; i += 1) {
      const j = Math.floor(rand() * n);
      bx[i] = xs[j];
      by[i] = ys[j];
    }
    const fit = leastSquares(bx, by);
    if (fit) slopes.push(fit.slope);
  }
  if (slopes.length < resamples * MIN_VALID_RESAMPLE_SHARE) return null;
  slopes.sort((a, b) => a - b);
  const m = slopes.length;
  return [
    slopes[Math.floor(0.025 * (m - 1))],
    slopes[Math.ceil(0.975 * (m - 1))],
  ];
}

/** A learner the Helping skills trend can classify, with their own change. */
export interface DoseResponseLearner {
  learnerId: number;
  /** Scored cuts the learner has (in scope), the x of the cuts fit. */
  cuts: number;
  /** Own first-half vs last-half composite change (unrounded). */
  change: number;
  trend: Exclude<LearnerTrend, 'tooEarly'>;
}

/**
 * The learners the scatter is drawn from: exactly the ones `learnerTrend`
 * classifies on the Helping skills tab (AAQ-171) — at least `trendMinCuts`
 * scored cuts and a noise estimate to size their band — with the same noise
 * (pooled over every learner in scope). Reused, never re-derived, so a learner
 * is "classified" here iff they are classified there.
 */
export function classifyDoseResponse(
  learners: readonly ProgressLearner[],
): DoseResponseLearner[] {
  const noise = cutNoiseSd(learners);
  const out: DoseResponseLearner[] = [];
  for (const l of learners) {
    const t = learnerTrend(l, noise);
    if (t.trend === 'tooEarly' || t.change === null) continue;
    out.push({
      learnerId: l.userId,
      cuts: l.cuts.length,
      change: t.change,
      trend: t.trend,
    });
  }
  return out;
}

export interface DoseResponsePointOut {
  learnerId: number;
  cuts: number;
  practiceMinutes: number | null;
  change: number;
  trend: Exclude<LearnerTrend, 'tooEarly'>;
}

export interface DoseResponseFitOut {
  x: 'cuts' | 'practiceHours';
  n: number;
  slope: number;
  slopeCi: [number, number] | null;
  intercept: number;
  detectable: boolean;
  xMin: number;
  xMax: number;
}

export interface DoseResponseOut {
  minLearners: number;
  classifiedLearners: number;
  measurable: boolean;
  learnersWithMinutes: number | null;
  learnersScatter: DoseResponsePointOut[] | null;
  fit: DoseResponseFitOut | null;
  minutesFit: DoseResponseFitOut | null;
}

function fitOut(
  x: DoseResponseFitOut['x'],
  xs: readonly number[],
  ys: readonly number[],
  minLearners: number,
): DoseResponseFitOut | null {
  if (xs.length < minLearners) return null;
  const fit = leastSquares(xs, ys);
  if (!fit) return null;
  const ci = bootstrapSlopeCi(xs, ys);
  return {
    x,
    n: xs.length,
    slope: round3(fit.slope),
    slopeCi: ci ? [round3(ci[0]), round3(ci[1])] : null,
    intercept: round2(fit.intercept),
    detectable: !!ci && (ci[0] > 0 || ci[1] < 0),
    xMin: round2(Math.min(...xs)),
    xMax: round2(Math.max(...xs)),
  };
}

/**
 * The scatter and its fits, behind the population gate.
 *
 * Below `minLearners` classified learners nothing but the counts travel:
 * `learnersScatter`, `fit` and `minutesFit` are null and `measurable` false.
 * `practiceMinutesByLearner` is null when the caller did not read minutes
 * (below the gate there is nothing to read them for); a learner absent from
 * the map had no measurable session duration and gets `practiceMinutes: null`,
 * never 0. The minutes fit is over those with minutes, behind the same gate,
 * with its slope per practice HOUR so the number is readable.
 *
 * Points sort by own change (biggest first), then id — never by level.
 */
export function buildDoseResponse(
  classified: readonly DoseResponseLearner[],
  practiceMinutesByLearner: ReadonlyMap<number, number> | null,
  minLearners = DOSE_RESPONSE_MIN_LEARNERS,
): DoseResponseOut {
  const measurable = classified.length >= minLearners;
  if (!measurable) {
    return {
      minLearners,
      classifiedLearners: classified.length,
      measurable: false,
      learnersWithMinutes: null,
      learnersScatter: null,
      fit: null,
      minutesFit: null,
    };
  }

  const points: DoseResponsePointOut[] = classified.map((l) => {
    const minutes = practiceMinutesByLearner?.get(l.learnerId);
    return {
      learnerId: l.learnerId,
      cuts: l.cuts,
      practiceMinutes:
        minutes === undefined || !Number.isFinite(minutes)
          ? null
          : round1(minutes),
      change: round2(l.change),
      trend: l.trend,
    };
  });
  points.sort((a, b) => b.change - a.change || a.learnerId - b.learnerId);

  const withMinutes = classified.filter((l) => {
    const m = practiceMinutesByLearner?.get(l.learnerId);
    return m !== undefined && Number.isFinite(m);
  });

  return {
    minLearners,
    classifiedLearners: classified.length,
    measurable: true,
    learnersWithMinutes: practiceMinutesByLearner ? withMinutes.length : null,
    learnersScatter: points,
    fit: fitOut(
      'cuts',
      classified.map((l) => l.cuts),
      classified.map((l) => l.change),
      minLearners,
    ),
    minutesFit: fitOut(
      'practiceHours',
      withMinutes.map(
        (l) => (practiceMinutesByLearner?.get(l.learnerId) as number) / 60,
      ),
      withMinutes.map((l) => l.change),
      minLearners,
    ),
  };
}
