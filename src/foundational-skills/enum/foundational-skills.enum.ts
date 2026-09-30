/** Outcome of one attempt to score a cut under one rubric version. */
export enum FhsAssessmentStatus {
  SCORED = 'SCORED',
  /** Retried on later ticks until `FHS_MAX_ATTEMPTS`, then left for a human. */
  FAILED = 'FAILED',
}
