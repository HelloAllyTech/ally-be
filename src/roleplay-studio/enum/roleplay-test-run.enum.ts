/** Lifecycle of one Improve test run (a batch of agent-test-case sessions). */
export enum RoleplayTestRunStatus {
  // Row created; the run request to ally-ai-learn is in flight.
  STARTED = 'STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Lifecycle of one per-test-case report row within a run. */
export enum RoleplayTestReportStatus {
  // Created with the run; waiting for ai-learn's per-unit webhook delivery.
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Auto-improve lifecycle stamped on the PARENT report while its evidence is
 * being fed through the copilot and the same test case is re-run:
 * IMPROVING (copilot turn streaming) → RERUNNING (patches applied, child run
 * in flight) → DONE; or NO_CHANGES (copilot made no update_spec call) /
 * FAILED (turn or re-run errored) as terminal short-circuits.
 */
export enum RoleplayReportImproveStatus {
  IMPROVING = 'IMPROVING',
  RERUNNING = 'RERUNNING',
  NO_CHANGES = 'NO_CHANGES',
  DONE = 'DONE',
  FAILED = 'FAILED',
}
