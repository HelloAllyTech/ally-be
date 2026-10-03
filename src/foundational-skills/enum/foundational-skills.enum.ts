/** Outcome of one attempt to score a cut under one rubric version. */
export enum FhsAssessmentStatus {
  SCORED = 'SCORED',
  /** Retried on later ticks until `FHS_MAX_ATTEMPTS`, then left for a human. */
  FAILED = 'FAILED',
}

/** Outcome of one attempt to score a benchmark session under one rubric version. */
export enum FhsBenchmarkStatus {
  SCORED = 'SCORED',
  /** Retried on later ticks until `FHS_MAX_ATTEMPTS`, then left for a human. */
  FAILED = 'FAILED',
  /**
   * Too little learner speech to score (`FHS_BENCHMARK_MIN_LEARNER_CHARS`).
   * Final: a settled session's turns do not change, so it is never retried.
   */
  SKIPPED = 'SKIPPED',
}
