/**
 * The miss record on a human-reported bug — OPP-0774.
 *
 * Bug Hunter's goal is to find a bug before any staff member or live user
 * experiences it, so every report a person files is, by definition, a bug it
 * did not find first. The miss record says why, in one of five ways, and names
 * the sense that would have had to see it. Aggregated, those two fields are
 * the Finder's roadmap: the sense with the most misses is the next one to
 * build, and a sense that keeps "missing" is the next one to fix.
 *
 * Stored under `bug_findings.metadata.miss` (the same scratchpad `regressed`
 * and `rediscoveredCount` live in) rather than as columns: it is written once
 * at intake by a cheap model, re-written when the description is edited, and
 * read by the drawer and the analytics tab. The 60-day table that preceded it
 * was classified by hand with exactly these reasons and senses.
 */
export const BUG_FINDING_MISS_REASONS = [
  /** No current sense could have seen it — a new sense is needed. */
  'no_sense',
  /** An existing sense covers this kind of defect and did not flag it. */
  'sense_missed',
  /** A sense found it (or its cause) and a person dismissed, rejected or cancelled it. */
  'detected_declined',
  /** A sense found it (or its cause) and it was still open, unmerged or unreleased. */
  'detected_not_fixed',
  /** Test entry, duplicate human report, feature request, or nothing to find. */
  'not_a_miss',
] as const;
export type BugFindingMissReason = (typeof BUG_FINDING_MISS_REASONS)[number];

/** Senses Bug Hunter has today. A `sense_missed` or `detected_*` miss names one of these. */
export const BUG_FINDING_EXISTING_SENSES = [
  'production_log',
  'browser_errors',
  'ux_signal',
  'code_review',
  'tests',
  'locale_parity',
] as const;

/** Senses Bug Hunter does not have yet. A `no_sense` miss names one of these. */
export const BUG_FINDING_MISSING_SENSES = [
  'user_journey',
  'data_integrity',
  'voice_qa',
  'api_contract',
  'visual',
  'mobile_crash',
  'static_content',
  'llm_output_eval',
] as const;

export const BUG_FINDING_MISS_SENSES = [
  ...BUG_FINDING_EXISTING_SENSES,
  ...BUG_FINDING_MISSING_SENSES,
] as const;
export type BugFindingMissSense = (typeof BUG_FINDING_MISS_SENSES)[number];

export interface BugFindingMiss {
  reason: BugFindingMissReason;
  /** Null only for `not_a_miss`. */
  sense: BugFindingMissSense | null;
  /** For `detected_*`: the earlier finding that was this bug or its cause. */
  matchedFindingId: string | null;
  confidence: number | null;
  rationale: string;
  classifiedAt: string;
  /** Which prompt and model wrote it, so a later re-classification is comparable. */
  model: string;
}

/**
 * Validate a model's answer into a miss record, or return null when the
 * answer is not usable. The reason/sense pairing is enforced here, not
 * trusted: a model that says `no_sense` and names `code_review` has
 * contradicted itself, and a record like that would pollute the counts.
 */
export function toBugFindingMiss(
  parsed: {
    reason?: unknown;
    sense?: unknown;
    matchedFindingId?: unknown;
    confidence?: unknown;
    rationale?: unknown;
  },
  model: string,
  now: Date = new Date(),
): BugFindingMiss | null {
  const reason = BUG_FINDING_MISS_REASONS.includes(parsed.reason as never)
    ? (parsed.reason as BugFindingMissReason)
    : null;
  if (!reason) return null;

  const rawSense =
    typeof parsed.sense === 'string' &&
    BUG_FINDING_MISS_SENSES.includes(parsed.sense as never)
      ? (parsed.sense as BugFindingMissSense)
      : null;
  let sense: BugFindingMissSense | null = rawSense;
  if (reason === 'not_a_miss') {
    sense = null;
  } else if (reason === 'no_sense') {
    if (!rawSense || !BUG_FINDING_MISSING_SENSES.includes(rawSense as never))
      return null;
  } else if (
    !rawSense ||
    !BUG_FINDING_EXISTING_SENSES.includes(rawSense as never)
  ) {
    return null;
  }

  const matchedFindingId =
    (reason === 'detected_declined' || reason === 'detected_not_fixed') &&
    typeof parsed.matchedFindingId === 'string' &&
    parsed.matchedFindingId.trim()
      ? parsed.matchedFindingId.trim()
      : null;

  const confidence =
    typeof parsed.confidence === 'number' &&
    parsed.confidence >= 0 &&
    parsed.confidence <= 1
      ? parsed.confidence
      : null;

  return {
    reason,
    sense,
    matchedFindingId,
    confidence,
    rationale:
      typeof parsed.rationale === 'string'
        ? parsed.rationale.slice(0, 600)
        : '',
    classifiedAt: now.toISOString(),
    model,
  };
}
