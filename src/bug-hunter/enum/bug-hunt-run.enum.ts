/**
 * Stored as `character varying` with a CHECK constraint, per repo convention
 * (see AnalyticsSuggestionStatus) — not a Postgres enum.
 */
export enum BugHuntTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
  /**
   * One admin, one bug, one click — a run scoped to a single finding, started
   * by `POST findings/:id/fix-session` rather than by a repo-wide sweep. It
   * skips Discover and Verify entirely (the bug is already known and already
   * confirmed) and runs only the Fix phase for that finding. Its
   * `bug_hunt_runs` row carries the same totals as any other run; they just
   * only ever sum to one finding.
   */
  FIX_SESSION = 'fix_session',
}

export enum BugHuntRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  /** The feature was off when this trigger fired; the run did no work. */
  SKIPPED_DISABLED = 'skipped_disabled',
}
