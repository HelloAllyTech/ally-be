/**
 * The attainable range of a scenario's session score (ruler R2), and the bands
 * a score is read in. Pure — no database — so the derivation, the band edges and
 * the flags are tested over fixtures. Used by scenario difficulty calibration
 * (EFF-32, AAQ-227) and exported for same-scenario repeat improvement (EFF-33),
 * which normalises a learner's change by this range when it can be derived.
 *
 * WHAT A SESSION SCORE IS MADE OF (read from the runtime, not the plan):
 * `scenario_sessions.score` is the worker's `ScoreKeeper.get_total_score()` —
 * the sum of every detected EVENT's points plus every detected BEHAVIOUR
 * INSTRUCTION's points (`ally-ai-learn/app/core/scoring/score_keeper.py`).
 *
 *  - Events: the scenario's live `scenario_events` mappings (ACTIVE base
 *    events) plus every PASSIVE base event, scored `COALESCE(mapping score,
 *    base score)`. An event fires at most `detectionConfig.maxOccurrences`
 *    times; with NO `maxOccurrences` the worker applies no cap at all
 *    (`app/core/graph/utils.py`), so its ceiling is unbounded.
 *  - Behaviour instructions: +10 per detected learner turn for SHOULD_DO, −10
 *    for SHOULD_NOT_DO (`BEHAVIOR_INSTRUCTION_*_SCORE`), re-checked on every
 *    learner turn and never capped.
 *
 * So a true ceiling exists only when every positive contributor is capped.
 * Where one is not, the derivation counts it ONCE — the score of "doing every
 * rewarded thing once each (or up to its cap)" — and says so:
 * `ceilingIsHard: false`, `uncappedPositive: n`. That nominal ceiling is still a
 * meaningful anchor for "where do scores land", and a session above it lands in
 * the `> 100%` band, which is counted and shown, never folded away. Against a
 * HARD ceiling a score above 100% is impossible under the config it was derived
 * from, so it marks a derivation problem (the scoring changed under the
 * sessions, or a contributor was missed) — see {@link isRangeSuspect}.
 */

export type ScoringContributorKind = 'event' | 'behaviour';

/** One thing that can add to (or take from) a session score. */
export interface ScoringContributor {
  kind: ScoringContributorKind;
  /** Points per firing. Null or 0 contributes nothing. */
  score: number | null;
  /**
   * `detectionConfig.maxOccurrences`. Null/undefined = no cap configured, which
   * the runtime treats as UNCAPPED (counted once here, and reported). 0 or a
   * negative value means the detector can never fire (`count >= cap` from the
   * first check), so the contributor adds nothing. Always null for behaviours.
   */
  maxOccurrences: number | null | undefined;
}

export interface AttainableRange {
  /** True when there is at least one positive contributor (max > 0). */
  derivable: boolean;
  /** Σ positive score × cap (cap 1 when uncapped). Null when not derivable. */
  max: number | null;
  /** Σ negative score × cap (cap 1 when uncapped); 0 with no negatives. Null when not derivable. */
  min: number | null;
  /** True only when derivable and every positive contributor is capped — `max` is a real ceiling. */
  ceilingIsHard: boolean;
  /** True only when derivable and every negative contributor is capped — `min` is a real floor. */
  floorIsHard: boolean;
  /** Positive contributors with no cap, each counted once in `max`. */
  uncappedPositive: number;
  /** Negative contributors with no cap, each counted once in `min`. */
  uncappedNegative: number;
  /** Contributors that can add points. */
  positiveContributors: number;
  /** Contributors that can take points away. */
  negativeContributors: number;
}

/**
 * The cap a contributor fires up to: a finite configured cap (floored to an
 * integer, as the worker's `int()` does), else null for "uncapped".
 */
function capOf(c: ScoringContributor): number | null {
  if (c.kind === 'behaviour') return null;
  const raw = c.maxOccurrences;
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.floor(raw);
}

/**
 * Derive a scenario's attainable score range from its scoring contributors.
 * See the file header for what counts and why an uncapped contributor is
 * counted once.
 */
export function deriveAttainableRange(
  contributors: readonly ScoringContributor[],
): AttainableRange {
  let max = 0;
  let min = 0;
  let uncappedPositive = 0;
  let uncappedNegative = 0;
  let positiveContributors = 0;
  let negativeContributors = 0;

  for (const c of contributors) {
    const score = c.score;
    if (score === null || score === undefined || !Number.isFinite(score)) {
      continue;
    }
    if (score === 0) continue;
    const cap = capOf(c);
    // A configured cap of 0 (or less) means the detector never fires.
    if (cap !== null && cap <= 0) continue;
    const firings = cap ?? 1;
    if (score > 0) {
      positiveContributors += 1;
      max += score * firings;
      if (cap === null) uncappedPositive += 1;
    } else {
      negativeContributors += 1;
      min += score * firings;
      if (cap === null) uncappedNegative += 1;
    }
  }

  const derivable = max > 0;
  return {
    derivable,
    max: derivable ? max : null,
    min: derivable ? min : null,
    ceilingIsHard: derivable && uncappedPositive === 0,
    floorIsHard: derivable && uncappedNegative === 0,
    uncappedPositive,
    uncappedNegative,
    positiveContributors,
    negativeContributors,
  };
}

/**
 * A score as a fraction of the attainable max (1 = the ceiling), or null when
 * the range is not derivable. Negative scores stay negative. This is the
 * normalisation EFF-33 applies to first/latest scores so changes compare across
 * scenarios; apply it to both scores of a pair with the SAME range.
 */
export function scoreShareOfMax(
  score: number,
  range: AttainableRange | null | undefined,
): number | null {
  if (!range || !range.derivable || range.max === null || range.max <= 0) {
    return null;
  }
  return score / range.max;
}

/* -------------------------------------------------------------------------- */
/* Bands                                                                       */
/* -------------------------------------------------------------------------- */

export const DERIVED_SCORE_BANDS = [
  { key: 'below0', label: '< 0' },
  { key: 'pct0to25', label: '0–25%' },
  { key: 'pct25to50', label: '25–50%' },
  { key: 'pct50to75', label: '50–75%' },
  { key: 'pct75to100', label: '75–100%' },
  { key: 'over100', label: '> 100%' },
] as const;

export const RAW_SCORE_BANDS = [
  { key: 'below0', label: '< 0' },
  { key: 'raw0to49', label: '0–49' },
  { key: 'raw50to99', label: '50–99' },
  { key: 'raw100plus', label: '100+' },
] as const;

export type DerivedScoreBandKey = (typeof DERIVED_SCORE_BANDS)[number]['key'];
export type RawScoreBandKey = (typeof RAW_SCORE_BANDS)[number]['key'];
export type ScoreBandKey = DerivedScoreBandKey | RawScoreBandKey;

/** The band that reads as "scored near the top" — the too-easy test. */
export const TOP_BAND_KEY = {
  derived: 'pct75to100',
  raw: 'raw100plus',
} as const satisfies Record<'derived' | 'raw', ScoreBandKey>;

/**
 * Band for a score read against the attainable max. Edges: below 0 is `< 0`;
 * then half-open quarters [0, 25%), [25%, 50%), [50%, 75%); the top band is
 * CLOSED at 100% so a session that earns exactly the ceiling is in it; above
 * 100% is `> 100%`.
 */
export function derivedBandKey(
  score: number,
  max: number,
): DerivedScoreBandKey {
  if (score < 0) return 'below0';
  const share = score / max;
  if (share < 0.25) return 'pct0to25';
  if (share < 0.5) return 'pct25to50';
  if (share < 0.75) return 'pct50to75';
  if (share <= 1) return 'pct75to100';
  return 'over100';
}

/** Band for a raw score: `< 0`, [0, 50), [50, 100), 100 and above. */
export function rawBandKey(score: number): RawScoreBandKey {
  if (score < 0) return 'below0';
  if (score < 50) return 'raw0to49';
  if (score < 100) return 'raw50to99';
  return 'raw100plus';
}

/* -------------------------------------------------------------------------- */
/* Flags                                                                       */
/* -------------------------------------------------------------------------- */

/** "Too easy": MORE than this share (%) of sessions in the top band. */
export const CALIBRATION_TOO_EASY_TOP_BAND_PCT = 80;
/** "Too hard": MORE than this share (%) of sessions below 0. */
export const CALIBRATION_TOO_HARD_BELOW_ZERO_PCT = 50;

export type CalibrationFlag = 'tooEasy' | 'tooHard';

/**
 * Too easy / too hard from band counts. Both cannot hold at once (80% + 50% >
 * 100%). Null with no sessions — no data is not a calibration verdict.
 */
export function calibrationFlag(
  topBandCount: number,
  belowZeroCount: number,
  sessions: number,
): CalibrationFlag | null {
  if (sessions <= 0) return null;
  if ((topBandCount / sessions) * 100 > CALIBRATION_TOO_EASY_TOP_BAND_PCT) {
    return 'tooEasy';
  }
  if ((belowZeroCount / sessions) * 100 > CALIBRATION_TOO_HARD_BELOW_ZERO_PCT) {
    return 'tooHard';
  }
  return null;
}

/**
 * Sessions above a HARD ceiling cannot happen under the config the ceiling was
 * derived from, so any of them means the derivation does not describe what
 * those sessions ran on. Above a nominal (uncapped-counted-once) ceiling they
 * are expected and say nothing about the derivation.
 */
export function isRangeSuspect(
  range: AttainableRange,
  overMaxCount: number,
): boolean {
  return range.ceilingIsHard && overMaxCount > 0;
}
