/**
 * A learner's completion record for one scenario, as surfaced on the learner
 * catalog (`GET /v2/learn/scenarios`) and scenario detail
 * (`GET /v1/learn/scenarios/:id`).
 *
 * Absent/null on a scenario the requesting user has never completed — the
 * frontend guards on the object's presence, not on `attemptCount > 0`.
 */
export interface ScenarioCompletionSummary {
  /** Completed sessions for this user + scenario. Always >= 1 when present. */
  attemptCount: number;
  /** `endedAt` of the most recent completed session. */
  lastCompletedAt: Date | null;
}
