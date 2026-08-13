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
}
