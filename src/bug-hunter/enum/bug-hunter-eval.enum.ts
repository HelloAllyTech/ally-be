/**
 * What an eval item says the truth is. Two values on purpose: the verifier
 * answers one question — "is this a real bug in this repo" — so the eval
 * grades exactly that. Declines for reasons that are not about truth
 * (`wont_fix`, `too_risky`, `duplicate`, `wrong_repo`) are excluded from the
 * set rather than forced into either bucket.
 */
export enum BugHunterEvalLabel {
  REAL = 'real',
  NOT_A_BUG = 'not_a_bug',
}

/**
 * Where a label came from, strongest first. A human saying "not a bug" is
 * ground truth; a verifier dismissal that nobody has contradicted in the
 * decline-suppression window is only probably right, and the replay report
 * keeps the two apart so a disagreement with the weak tier is not counted the
 * same as one with a human.
 */
export enum BugHunterEvalLabelSource {
  /** An admin rejected it as not_a_bug. */
  HUMAN_DECLINED = 'human_declined',
  /** A finder-error dismissal that a later shipped fix proved wrong — the bug was real. */
  REVERSED = 'reversed',
  /** The fix merged or released and no regression was recorded — the bug was real. */
  MERGED_HELD = 'merged_held',
  /** The fix shipped and the bug came back — real, and hard. */
  REGRESSED = 'regressed',
  /** The Verify phase refuted it and nothing since has contradicted that. Weak. */
  VERIFIER_DISMISSED = 'verifier_dismissed',
}

/** Which prompt a stored eval run exercised. Only the verifier is replayable today. */
export enum BugHunterEvalPromptKind {
  VERIFIER = 'verifier',
}
