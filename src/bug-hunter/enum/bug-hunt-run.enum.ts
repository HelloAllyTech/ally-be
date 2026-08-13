/**
 * Stored as `character varying` with a CHECK constraint, per repo convention
 * (see AnalyticsSuggestionStatus) — not a Postgres enum.
 */
export enum BugHuntTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

export enum BugHuntRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  /** The feature was off when this trigger fired; the run did no work. */
  SKIPPED_DISABLED = 'skipped_disabled',
}
