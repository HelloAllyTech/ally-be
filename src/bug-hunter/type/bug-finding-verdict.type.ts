/**
 * An independent verifier's judgement on a FINDING — OPP-0780.
 *
 * The sweep's own Verify phase runs two sub-agents on the same engine, inside
 * the same run, with the same context that produced the finding. That is a
 * useful first filter and a poor gate: it shares the finder's blind spots,
 * and on Gemini it does not run at all. So once a sweep closes, Bug Hunter
 * opens one more run on the OTHER vendor, hands it every unproven finding
 * the sweep kept, and asks it to reproduce each and then try to refute it.
 *
 * Until that run has spoken, an unproven finding is `pending`: it is listed,
 * but Bug Hunter does not fix it in AI mode. `confirmed` findings in AI mode
 * get a fix session started by the server; `refuted` ones are dismissed with
 * the verifier's reason; `unsure` ones are held for a person.
 */
export const BUG_FINDING_VERDICTS = ['confirmed', 'refuted', 'unsure'] as const;
export type BugFindingVerdictWord = (typeof BUG_FINDING_VERDICTS)[number];

export type IndependentVerification = 'pending' | BugFindingVerdictWord;

export interface BugFindingVerdict {
  verdict: BugFindingVerdictWord;
  /** 0–1: how sure the verifier is of its own verdict. */
  confidence: number | null;
  /** What was done to reproduce it, and what happened — a command, a test, an observation. */
  reproduction: string | null;
  /** What was tried to disprove it, and why it did or did not hold. */
  refutation: string | null;
  /** The sentence that would have to be false for this verdict to be wrong. */
  wouldBeWrongIf: string | null;
  /** Which engine and model judged, as the run reported them. */
  by: { engine: string | null; model: string | null };
  runId: string | null;
  at: string;
}

const str = (v: unknown, max = 600): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/**
 * Validate a verifier's report into a verdict, or null when unusable. A
 * `confirmed` with no reproduction is downgraded to `unsure`: a confirmation
 * nobody reproduced is an opinion, and opinions are held for a person.
 */
export function toBugFindingVerdict(
  parsed: Record<string, unknown> | null | undefined,
  context: {
    by: { engine: string | null; model: string | null };
    runId: string | null;
    now?: Date;
  },
): BugFindingVerdict | null {
  if (!parsed || typeof parsed !== 'object') return null;
  if (!BUG_FINDING_VERDICTS.includes(parsed.verdict as never)) return null;
  let verdict = parsed.verdict as BugFindingVerdictWord;
  const reproduction = str(parsed.reproduction);
  const refutation = str(parsed.refutation);
  if (verdict === 'confirmed' && !reproduction) verdict = 'unsure';
  if (verdict === 'refuted' && !refutation) verdict = 'unsure';
  const confidence =
    typeof parsed.confidence === 'number' &&
    parsed.confidence >= 0 &&
    parsed.confidence <= 1
      ? parsed.confidence
      : null;
  return {
    verdict,
    confidence,
    reproduction,
    refutation,
    wouldBeWrongIf: str(parsed.wouldBeWrongIf),
    by: context.by,
    runId: context.runId,
    at: (context.now ?? new Date()).toISOString(),
  };
}

/** Where a finding stands with the independent verifier, from its metadata. */
export function independentVerificationOf(
  metadata: Record<string, any> | null | undefined,
): IndependentVerification | null {
  const v = metadata?.independentVerification;
  return v === 'pending' || BUG_FINDING_VERDICTS.includes(v as never)
    ? (v as IndependentVerification)
    : null;
}
