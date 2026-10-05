/**
 * Agreement between two raters on the same items — Cohen's kappa, unweighted
 * and quadratic-weighted, from a confusion matrix.
 *
 *   κ = 1 − Σ wᵢⱼ·Oᵢⱼ / Σ wᵢⱼ·Eᵢⱼ
 *
 * O is the observed share of items rated (i by the first rater, j by the
 * second), E the share expected by chance from the two raters' own marginals,
 * and w the disagreement weight: 0 on the diagonal, and off it either 1
 * (unweighted — every disagreement counts the same; this is (pₒ − pₑ)/(1 − pₑ))
 * or ((i − j)/(k − 1))² (quadratic — for ORDINAL categories, so a 3-vs-4
 * disagreement costs a ninth of a 1-vs-4 one on a four-level scale).
 *
 * 1 is perfect agreement, 0 is what chance alone produces, below 0 is worse
 * than chance. κ is undefined (null here) when chance agreement is already
 * total — both raters used one and the same category throughout — because
 * there is nothing for agreement to beat; the raw percentage still says what
 * happened.
 */

/** Ratings are the same 1–4 levels the FHS rubric derives. */
export const FHS_LEVEL_CATEGORIES = [1, 2, 3, 4] as const;
export const BINARY_CATEGORIES = [0, 1] as const;

/**
 * κ and % agreement are withheld below this many distinct rated cuts (per
 * skill, per comparison). A κ from a dozen cuts can swing by ±0.4 on one cut
 * changing hands. The counts behind it always travel.
 */
export const MIN_RATED_CUTS_FOR_AGREEMENT = 20;

export type KappaWeighting = 'unweighted' | 'quadratic';

/** Count matrix: rows = first rater's category, columns = the second's. */
export function confusionMatrix(
  pairs: readonly (readonly [number, number])[],
  categories: readonly number[],
): number[][] {
  const index = new Map(categories.map((c, i) => [c, i]));
  const m = categories.map(() => categories.map(() => 0));
  for (const [a, b] of pairs) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined) continue;
    m[i][j] += 1;
  }
  return m;
}

function weight(
  i: number,
  j: number,
  k: number,
  weighting: KappaWeighting,
): number {
  if (i === j) return 0;
  if (weighting === 'unweighted' || k < 2) return 1;
  const d = (i - j) / (k - 1);
  return d * d;
}

/** κ from a square count matrix; null with no items or no chance disagreement. */
export function kappaFromMatrix(
  matrix: readonly (readonly number[])[],
  weighting: KappaWeighting = 'unweighted',
): number | null {
  const k = matrix.length;
  const n = matrix.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  if (k === 0 || n === 0) return null;
  const rows = matrix.map((row) => row.reduce((a, b) => a + b, 0) / n);
  const cols = matrix[0].map(
    (_, j) => matrix.reduce((s, row) => s + row[j], 0) / n,
  );
  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const w = weight(i, j, k, weighting);
      observed += (w * matrix[i][j]) / n;
      expected += w * rows[i] * cols[j];
    }
  }
  if (expected <= 1e-12) return null;
  return 1 - observed / expected;
}

/** Cohen's κ over paired ratings. */
export function cohensKappa(
  pairs: readonly (readonly [number, number])[],
  categories: readonly number[],
  weighting: KappaWeighting = 'unweighted',
): number | null {
  return kappaFromMatrix(confusionMatrix(pairs, categories), weighting);
}

/** Percent of pairs on which both raters gave the same category; null with none. */
export function percentAgreement(
  pairs: readonly (readonly [number, number])[],
): number | null {
  if (pairs.length === 0) return null;
  const same = pairs.filter(([a, b]) => a === b).length;
  return (100 * same) / pairs.length;
}

/** Round to `dp` places, keeping null; avoids `-0` in a response. */
export function roundOrNull(v: number | null, dp = 3): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  return r === 0 ? 0 : r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Floored summaries — what the chart shows for one comparison of one skill
// ─────────────────────────────────────────────────────────────────────────────

/** One paired judgement of one cut. */
export interface RatedPair {
  cutId: string;
  a: number;
  b: number;
}

export interface LevelAgreement {
  /** Pairs compared (judge vs human: one per rating; human vs human: one per rater pair). */
  pairs: number;
  /** Distinct cuts behind the pairs — the unit the floor counts. */
  cuts: number;
  kappa: number | null;
  weightedKappa: number | null;
  exactAgreementPct: number | null;
  /** Mean of a − b over the pairs (judge − human); null when there is no direction. */
  meanDifference: number | null;
  /** 4×4 counts, rows = a's level 1–4, columns = b's. Counts always travel. */
  confusion: number[][];
}

export interface BinaryAgreement {
  pairs: number;
  cuts: number;
  kappa: number | null;
  agreementPct: number | null;
  /** Both said yes. */
  both: number;
  /** Only the first said yes. */
  onlyFirst: number;
  /** Only the second said yes. */
  onlySecond: number;
  /** Both said no. */
  neither: number;
}

const distinctCuts = (pairs: readonly RatedPair[]): number =>
  new Set(pairs.map((p) => p.cutId)).size;

/**
 * Level agreement over pairs where BOTH sides found an opportunity. κ, the
 * weighted κ, % exact and the mean difference are null below
 * `minCuts` distinct cuts; `pairs`, `cuts` and the confusion counts travel.
 * `directional` is false for human vs human, where which rater is "first" is
 * an arbitrary ordering and a mean difference would mean nothing.
 */
export function levelAgreement(
  pairs: readonly RatedPair[],
  opts: { minCuts?: number; directional?: boolean } = {},
): LevelAgreement {
  const minCuts = opts.minCuts ?? MIN_RATED_CUTS_FOR_AGREEMENT;
  const tuples = pairs.map((p) => [p.a, p.b] as const);
  const confusion = confusionMatrix(tuples, FHS_LEVEL_CATEGORIES);
  const cuts = distinctCuts(pairs);
  const floored = cuts < minCuts;
  const meanDiff =
    tuples.length === 0
      ? null
      : tuples.reduce((s, [a, b]) => s + (a - b), 0) / tuples.length;
  return {
    pairs: pairs.length,
    cuts,
    kappa: floored ? null : roundOrNull(kappaFromMatrix(confusion)),
    weightedKappa: floored
      ? null
      : roundOrNull(kappaFromMatrix(confusion, 'quadratic')),
    exactAgreementPct: floored
      ? null
      : roundOrNull(percentAgreement(tuples), 1),
    meanDifference:
      floored || opts.directional === false ? null : roundOrNull(meanDiff, 2),
    confusion,
  };
}

/**
 * Agreement on a yes/no call (an opportunity arose; any unhelpful behaviour).
 * `a`/`b` are 1 for yes, 0 for no. κ and % are null below `minCuts`.
 */
export function binaryAgreement(
  pairs: readonly RatedPair[],
  opts: { minCuts?: number } = {},
): BinaryAgreement {
  const minCuts = opts.minCuts ?? MIN_RATED_CUTS_FOR_AGREEMENT;
  const tuples = pairs.map((p) => [p.a, p.b] as const);
  const m = confusionMatrix(tuples, BINARY_CATEGORIES);
  const cuts = distinctCuts(pairs);
  const floored = cuts < minCuts;
  return {
    pairs: pairs.length,
    cuts,
    kappa: floored ? null : roundOrNull(kappaFromMatrix(m)),
    agreementPct: floored ? null : roundOrNull(percentAgreement(tuples), 1),
    both: m[1][1],
    onlyFirst: m[1][0],
    onlySecond: m[0][1],
    neither: m[0][0],
  };
}
