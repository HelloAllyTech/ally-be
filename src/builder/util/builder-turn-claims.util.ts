/**
 * What Builder's reply claims about the PRD, read from its words.
 *
 * Two claims matter because the admin acts on them: "I've updated the PRD"
 * (they stop checking the document) and "the PRD is ready" (they press Start).
 * Session 2bc3a5cf's last reply said "revised" over an edit that had failed.
 * The validated turn checks both against the document before the reply is
 * shown, and the replay eval counts the ones that got through — the same
 * patterns for both, so the eval measures what the runner enforces.
 *
 * Deliberately narrow. "I'll update" is a promise, not a claim, and is left
 * alone; a check that fires on ordinary sentences teaches the model to write
 * around it rather than to make the edit.
 */

/** Prose that tells the admin the PRD moved. */
export const CLAIMS_A_PRD_EDIT =
  /\b(I'?ve|I have|I)\s+(just\s+)?(updated|revised|added|amended|rewritten|recorded|captured|incorporated|reflected|written)\b|\b(updated|revised)\s+the\s+PRD\b|\bPRD\s+(is|has been|now)\s+(updated|revised)\b/i;

export function claimsPrdEdit(text: string | null | undefined): boolean {
  return CLAIMS_A_PRD_EDIT.test(String(text ?? ''));
}

/** Prose that tells the admin the PRD can be built from now. */
const CLAIMS_READY =
  /\b(build[- ]ready|ready (to|for) (be )?(build|built|building|the build|a build|technical design|the technical design|design)|(PRD|it|document|spec) is (now )?(ready|complete)|readiness is (now )?(at )?100)/gi;

/** Words just before a match that make it something other than a claim. */
const NOT_A_CLAIM =
  /(?:\b(?:not|never|almost|nearly|once|until|when|before|after|if|close to)|n['’]t)\s+(?:yet\s+)?(?:\w+\s+){0,2}$/i;

export function claimsPrdReady(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  for (const match of value.matchAll(CLAIMS_READY)) {
    const before = value.slice(
      Math.max(0, (match.index ?? 0) - 30),
      match.index,
    );
    if (!NOT_A_CLAIM.test(before)) return true;
  }
  return false;
}
