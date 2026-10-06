/** Outcome of one attempt to map a session debrief's improvements to skills. */
export enum FeedbackSkillLinkStatus {
  /** Every improvement filed under one skill key or `null` (no skill fits). */
  MAPPED = 'MAPPED',
  /** Retried on later ticks until `FHS_MAX_ATTEMPTS`, then left for a human. */
  FAILED = 'FAILED',
  /**
   * Nothing to map — no improvement with any text, or a malformed list. Final:
   * a settled debrief does not change, so it is never retried. No model call.
   */
  SKIPPED = 'SKIPPED',
}
