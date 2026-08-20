/**
 * Definition of the Roleplay Quality Index — the composite behind the
 * "Roleplay quality" card on Highlights → Quality & sentiment.
 *
 * The index blends four per-bucket measurements into one 0-100 line:
 *
 *   1. actorComposite  — the actor-goal judge's composite (already 0-100)
 *   2. driftRate       — % of judged sessions that drifted out of character
 *   3. languageErrors  — severity-weighted language errors per 100 judged turns
 *   4. responseLatency — median user-stops-speaking -> agent-starts-speaking ms
 *
 * Groundedness is deliberately absent: it judges the learner-facing feedback
 * text, not the roleplay, so it belongs to a different question.
 *
 * ---------------------------------------------------------------------------
 * These are the index's DEFINITION, not tuning knobs. Same discipline as
 * WEAK_METRICS_PARAMS: change a weight or a direction and every historical
 * point silently moves, with no learner or agent having behaved differently.
 * Treat an edit here exactly like a judge-prompt change — bump
 * QUALITY_INDEX_VERSION so a step in the line can be told apart from a step in
 * the product. The version travels in the payload and is rendered on the card.
 *
 * The thresholds each dimension is normalised against are NOT here: they are
 * measured from production data and live in `analytics_quality_thresholds`.
 * See {@link QualityThresholdCalibrationService}.
 * ---------------------------------------------------------------------------
 */

/** Bump on ANY change to weights, directions, or a dimension's raw metric. */
export const QUALITY_INDEX_VERSION = 'v1';

/** The four dimensions, in the order they stack on the chart. */
export const QUALITY_INDEX_DIMENSIONS = [
  'actorComposite',
  'driftRate',
  'languageErrors',
  'responseLatency',
] as const;

export type QualityIndexDimension = (typeof QUALITY_INDEX_DIMENSIONS)[number];

/**
 * Weights, summing to 1.
 *
 * Equal quarters, and the rationale is that nothing else is defensible yet.
 * Weighting is the composite's whole attack surface — any split other than an
 * even one is a claim about relative importance that we would have to argue for
 * on evidence we do not have. An even split makes no such claim, and a reader
 * who disagrees can re-weight in their head because the contribution stack
 * shows each dimension separately.
 *
 * Two things to know before changing one:
 *   - The stack layers ARE these weights. A layer's height is
 *     `weight * normalisedScore`, so the four layers sum exactly to the index
 *     line. Change a weight and every bucket in history redraws.
 *   - Bump QUALITY_INDEX_VERSION in the same commit. A weight change and a
 *     product regression look identical on the chart otherwise.
 */
export const QUALITY_INDEX_WEIGHTS: Record<QualityIndexDimension, number> = {
  actorComposite: 0.25,
  driftRate: 0.25,
  languageErrors: 0.25,
  responseLatency: 0.25,
};

/**
 * Human-readable labels, used for the stack legend and the coverage line.
 * Kept server-side so the card and any CSV export cannot disagree.
 */
export const QUALITY_INDEX_LABELS: Record<QualityIndexDimension, string> = {
  actorComposite: 'Actor goal score',
  driftRate: 'Stayed in character',
  languageErrors: 'Language quality',
  responseLatency: 'Response latency',
};

/**
 * The unit of each dimension's RAW measurement, for the tooltip. The normalised
 * 0-100 score is what the chart plots; the raw value is what a reader needs in
 * order to sanity-check it against the Drift, Language and Latency tabs.
 */
export const QUALITY_INDEX_RAW_UNITS: Record<QualityIndexDimension, string> = {
  actorComposite: 'score',
  driftRate: '% of sessions drifted',
  languageErrors: 'weighted errors / 100 turns',
  responseLatency: 'ms (median)',
};

/**
 * Severity -> weight for the language dimension. Copied deliberately from
 * `SEVERITY_WEIGHT_SQL` in weak-metrics-analytics.repository so the two tabs
 * cannot drift apart silently: if you change one, change both, and bump both
 * version stamps.
 */
export const QUALITY_INDEX_SEVERITY_WEIGHT_SQL = `CASE a."severity"
  WHEN 'minor' THEN 1 WHEN 'major' THEN 5 WHEN 'critical' THEN 10 ELSE 1 END`;

/**
 * Judge versions the index is pinned to, per family.
 *
 * A composite over unpinned judge output is uninterpretable: a rubric change
 * moves the line with nobody having practised differently. These mirror the
 * targets in `judge-backlog-drain.service.ts` — when that drainer is pointed at
 * a new version, this moves with it AND the version stamp is bumped.
 *
 * Consequence worth knowing: the index's history reaches only as far back as
 * each family's backlog has been drained into these versions. That is why every
 * dimension reports its own coverage rather than the card claiming one window.
 */
export const QUALITY_INDEX_JUDGE_PINS = {
  drift: { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
  language: { judgeModel: 'gemini-2.5-pro', judgePromptVersion: 'v2' },
} as const;

/**
 * Whether a HIGHER raw value is better, per dimension. This is not cosmetic:
 * it decides which end of the measured distribution becomes the 100 anchor
 * during calibration, and it is why one normalisation formula serves all four
 * (see {@link normaliseToIndexScale}).
 */
export const QUALITY_INDEX_HIGHER_IS_BETTER: Record<
  QualityIndexDimension,
  boolean
> = {
  actorComposite: true,
  driftRate: false,
  languageErrors: false,
  responseLatency: false,
};

/**
 * PLACEHOLDER thresholds, shipped so the card renders on day one and replaced
 * in production by the calibration task.
 *
 * They are honest guesses, not measurements, which is why the row carries
 * `source = 'placeholder'` and the card says so in as many words. A reader must
 * never be shown a calibrated-looking index built on invented anchors.
 *
 * `target` is the raw value that maps to 100, `ceiling` the raw value that maps
 * to 0. Their ORDER encodes the direction, so no separate sign handling is
 * needed downstream.
 */
export const QUALITY_INDEX_PLACEHOLDER_THRESHOLDS: Record<
  QualityIndexDimension,
  { target: number; ceiling: number }
> = {
  actorComposite: { target: 90, ceiling: 40 },
  driftRate: { target: 0, ceiling: 25 },
  languageErrors: { target: 0, ceiling: 20 },
  responseLatency: { target: 800, ceiling: 3000 },
};

/**
 * How far into the distribution, from each end, the anchors sit.
 *
 * The good decile becomes 100 and the bad decile becomes 0, rather than the min
 * and max: an index anchored on extremes is anchored on two outliers, and one
 * pathological bucket would flatten the whole line into the middle.
 *
 * Deciles rather than quartiles because the anchors should sit outside normal
 * operating range — if today's typical bucket scored 50 by construction, the
 * chart could never show the platform as broadly good or broadly bad.
 *
 * Expressed as a tail fraction from the GOOD end and the BAD end, so the same
 * pair serves both directions: `resolveCalibrationPercentiles` turns them into
 * actual percentiles using the dimension's direction.
 */
export const QUALITY_INDEX_CALIBRATION_TAILS = {
  good: 0.1,
  bad: 0.1,
} as const;

/**
 * Grain the anchors are measured at — and the one genuine compromise in the
 * index.
 *
 * What the chart plots per bucket is an AGGREGATE: a mean score, a drift rate,
 * a median latency. The spread of those aggregates depends on the grain, since
 * a rate over one day swings far harder than the same rate over one month. So
 * anchors measured at one grain are only exactly right at that grain.
 *
 * Fixed at weekly, which is the middle of the range readers actually use, and
 * the consequence is stated rather than hidden: on a daily grain the line
 * swings wider against these anchors, and on a yearly grain it compresses. The
 * distortion is symmetric — it widens or narrows the swing without biasing the
 * level — so a trend stays readable at every grain even though the absolute
 * value is calibrated for weeks.
 *
 * The alternative, a set of anchors per grain, was rejected: four dimensions
 * times four grains is sixteen frozen constants nobody could audit, and it
 * would make the same underlying week score differently depending on which
 * control the reader had touched last.
 */
export const QUALITY_INDEX_CALIBRATION_GRAIN = 'week';

/**
 * Eligible buckets needed before a dimension's deciles are trusted.
 *
 * Deciles over three buckets are not deciles, they are the min and max wearing
 * a different name. Eight weeks is the smallest window where the 10th and 90th
 * percentiles are interpolated across enough points to describe a range rather
 * than name two specific weeks.
 *
 * A dimension short of this keeps its placeholder and is retried next tick,
 * which is exactly what the task is for.
 */
export const QUALITY_INDEX_CALIBRATION_MIN_BUCKETS = 8;

/**
 * Turn a dimension's direction into the two percentiles to read.
 *
 * For a higher-is-better dimension the good end is the TOP of the distribution,
 * so the 100 anchor is p90 and the 0 anchor is p10; for lower-is-better the
 * pair is inverted. Callers use the returned `target`/`ceiling` percentiles
 * directly in `percentile_cont`, and never have to think about sign again.
 */
export function resolveCalibrationPercentiles(higherIsBetter: boolean): {
  target: number;
  ceiling: number;
} {
  const { good, bad } = QUALITY_INDEX_CALIBRATION_TAILS;
  return higherIsBetter
    ? { target: 1 - good, ceiling: bad }
    : { target: good, ceiling: 1 - bad };
}

/**
 * Sessions (or turns, for latency) a dimension needs before its measured
 * anchors are trusted enough to freeze.
 *
 * 20 matches MIN_SCORE_SAMPLE_SIZE and WEAK_METRICS_PARAMS.minBucketDenominator
 * so "too thin to say" means one thing platform-wide. A dimension under the
 * floor keeps its placeholder and the task retries on the next tick — which is
 * the whole reason calibration is a task and not inline migration SQL.
 */
export const QUALITY_INDEX_CALIBRATION_MIN_SAMPLE = 20;

/**
 * How far back calibration looks when measuring the anchors.
 *
 * 90 days, and bounded on purpose: the anchors should describe how the platform
 * behaves NOW, and a window reaching into pre-pinning history would calibrate
 * against judge output the index does not plot. It also keeps the latency
 * percentile scan over `scenario_session_turn_metrics` cheap enough to run on a
 * scheduler tick.
 */
export const QUALITY_INDEX_CALIBRATION_WINDOW_DAYS = 90;

/**
 * Map a raw measurement onto the index's 0-100 scale.
 *
 * One formula for all four dimensions: `target` is the raw value worth 100 and
 * `ceiling` the raw value worth 0, so a lower-is-better dimension simply has
 * `target < ceiling` and needs no special case. Clamped, because a bucket
 * better than the good decile is not worth 112.
 *
 * Returns null when the anchors are degenerate (equal), which would otherwise
 * divide by zero — a dimension whose good and bad deciles coincide has nothing
 * to say and is reported as uncovered rather than as a score.
 */
export function normaliseToIndexScale(
  raw: number,
  target: number,
  ceiling: number,
): number | null {
  if (target === ceiling) return null;
  const scaled = (100 * (raw - ceiling)) / (target - ceiling);
  return Math.max(0, Math.min(100, Math.round(scaled * 10) / 10));
}
