/**
 * One value per pipeline step the workflow can report. Stored as
 * `character varying` with a CHECK constraint (repo convention, not a
 * Postgres enum — see AnalyticsSuggestionStatus for why).
 *
 * `SKIPPED_DISABLED` and `SETTINGS_CHANGED` are not pipeline steps: the first
 * is the whole content of a run that found the kill switch off, and the
 * second is emitted by the settings write path itself (not a run), with
 * `runId` null, so the on/off history is visible in the same timeline.
 */
export enum BugHuntEventStage {
  SKIPPED_DISABLED = 'skipped_disabled',
  FINDER_RESULT = 'finder_result',
  VERIFY = 'verify',
  FIX_ATTEMPT = 'fix_attempt',
  TEST_WRITTEN = 'test_written',
  DOC_UPDATED = 'doc_updated',
  PR_OPENED = 'pr_opened',
  MERGED = 'merged',
  ESCALATED = 'escalated',
  ERROR = 'error',
  SETTINGS_CHANGED = 'settings_changed',
  /** An admin pressed "Start fix session" and the GitHub Actions dispatch was accepted. */
  SESSION_DISPATCHED = 'session_dispatched',
  /** An admin pressed "Release to production" and the repo's release workflow was dispatched. */
  RELEASE_DISPATCHED = 'release_dispatched',
  /** The release workflow finished successfully — the fix is live. */
  RELEASED = 'released',
  /** The release workflow finished red. The fix is merged to master but NOT deployed. */
  RELEASE_FAILED = 'release_failed',
  /** A fix agent found the bug spans repos and reported an ordered plan. */
  PLAN_CREATED = 'plan_created',
  /** The orchestrator dispatched the next step of a plan. */
  STEP_STARTED = 'step_started',
  /** An admin pressed "Stop fix session" — see BugFixSessionService.cancelFixSession. */
  CANCELLED = 'cancelled',
  /**
   * An admin rewrote the bug's description before putting Bug Hunter on it —
   * see BugFindingService.editDescription. Recorded because the description IS
   * the fix agent's brief, so a reviewer asking why a session went the way it
   * did needs to see that the brief changed, and when relative to the dispatch.
   */
  DESCRIPTION_EDITED = 'description_edited',
  /**
   * An admin pinned or un-pinned the coarse roadmap stage by hand — see
   * BugFindingService.setStage. Recorded because a hand-set stage deliberately
   * stops tracking `status`, so the timeline is the only place a later reader
   * can see why the two disagree, and who decided they should.
   */
  STAGE_CHANGED = 'stage_changed',
}
