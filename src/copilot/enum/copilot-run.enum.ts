/**
 * Lifecycle status of a Copilot auto-build run.
 *
 * STARTED      -> run row created, draft scenario being provisioned
 * GENERATING   -> per-field LLM generation in progress for the current round
 * EVALUATING   -> practice conversation + LLM-judge evaluation in flight
 *                 (the run is "parked" waiting on the scenario-report webhook)
 * REFINING     -> a round scored < threshold; preparing the next round
 * SUCCEEDED    -> a round scored >= threshold (terminal)
 * FAILED       -> max rounds exhausted without reaching threshold, or an
 *                 unrecoverable error (terminal)
 * CANCELLED    -> user cancelled the run (terminal)
 */
export enum CopilotRunStatus {
  STARTED = 'STARTED',
  GENERATING = 'GENERATING',
  EVALUATING = 'EVALUATING',
  REFINING = 'REFINING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/**
 * Internal EventEmitter2 event the scenario-report service emits when a report
 * reaches a terminal status. The Copilot orchestrator subscribes to it to
 * resume its state machine for the round whose report just finished.
 */
export const COPILOT_REPORT_COMPLETED_EVENT = 'copilot.report.completed';

export interface CopilotReportCompletedPayload {
  reportId: string;
}
