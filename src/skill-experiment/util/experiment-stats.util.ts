/** What the decision rule needs to know about one arm's judged outputs. */
export interface ArmStats {
  n: number;
  /** Mean score, 0–100. */
  mean: number;
  /** Sample standard deviation. */
  sd: number;
}

export type ArmVerdict = 'challenger_wins' | 'challenger_loses' | 'undecided';

export interface ArmComparison {
  verdict: ArmVerdict;
  /** challenger.mean − champion.mean, in score points. */
  diff: number;
  /** Welch z statistic of the difference (one-sided). */
  z: number;
}

/** One-sided 95%: the challenger is ahead and it is not luck. */
export const SIGNIFICANCE_Z = 1.645;

/**
 * Welch z for the difference of two means. With both arms at the minimum sample
 * size (≥ 10 is enforced on the setting) the normal approximation is close
 * enough for a keep/retire decision, and it keeps the rule explainable on the
 * admin screen: "ahead by at least X points, and the gap is significant".
 */
export function welchZ(champion: ArmStats, challenger: ArmStats): number {
  const diff = challenger.mean - champion.mean;
  const se = Math.sqrt(
    (champion.sd * champion.sd) / Math.max(champion.n, 1) +
      (challenger.sd * challenger.sd) / Math.max(challenger.n, 1),
  );
  if (se === 0) return diff === 0 ? 0 : diff > 0 ? Infinity : -Infinity;
  return diff / se;
}

/**
 * Should the challenger replace the champion?
 *
 *  - Undecided until BOTH arms have `minSamples` judged outputs.
 *  - Wins when it leads by at least `minImprovement` points AND the lead is
 *    significant. Both, because a significant 0.3-point gain is not worth
 *    replacing a prompt for, and a large gain on noise is not a gain.
 *  - Loses when it is significantly worse, or when it has had twice the minimum
 *    sample without winning — more data rarely rescues a challenger that
 *    could not separate by then, and the loop's budget is better spent on the
 *    next draft.
 */
export function compareArms(
  champion: ArmStats,
  challenger: ArmStats,
  options: { minSamples: number; minImprovement: number },
): ArmComparison {
  const diff = challenger.mean - champion.mean;
  const z = welchZ(champion, challenger);
  if (champion.n < options.minSamples || challenger.n < options.minSamples) {
    return { verdict: 'undecided', diff, z };
  }
  if (diff >= options.minImprovement && z >= SIGNIFICANCE_Z) {
    return { verdict: 'challenger_wins', diff, z };
  }
  if (z <= -SIGNIFICANCE_Z || challenger.n >= options.minSamples * 2) {
    return { verdict: 'challenger_loses', diff, z };
  }
  return { verdict: 'undecided', diff, z };
}

/** Score points behind the champion that end a challenger before its full sample. */
export const EARLY_STOP_GAP = 15;
/** Share of broken or failed outputs that ends a challenger early. */
export const EARLY_STOP_FAILURE_RATE = 0.2;
/** Failures needed before the rate is trusted at all. */
export const EARLY_STOP_MIN_FAILURES = 3;

/**
 * The guardrail that keeps a bad draft from serving its full sample: a
 * challenger is pulled as soon as it is clearly worse or it breaks the output
 * format the call site parses. Returns the reason, or null to keep going.
 *
 * "Clearly worse" waits for a third of the minimum sample (at least 8) so a
 * couple of unlucky first outputs cannot end a draft that would have won.
 */
export function earlyStopReason(
  champion: ArmStats,
  challenger: ArmStats & { formatFailures: number },
  minSamples: number,
): string | null {
  if (
    challenger.formatFailures >= EARLY_STOP_MIN_FAILURES &&
    challenger.formatFailures / Math.max(challenger.n, 1) >
      EARLY_STOP_FAILURE_RATE
  ) {
    return (
      `${challenger.formatFailures} of ${challenger.n} outputs failed or broke ` +
      'the expected output format'
    );
  }
  const floor = Math.max(8, Math.ceil(minSamples / 3));
  if (
    challenger.n >= floor &&
    challenger.mean <= champion.mean - EARLY_STOP_GAP
  ) {
    return (
      `Scoring ${challenger.mean.toFixed(1)} against the champion's ` +
      `${champion.mean.toFixed(1)} after ${challenger.n} outputs`
    );
  }
  return null;
}
