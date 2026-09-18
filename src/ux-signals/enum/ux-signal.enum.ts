/**
 * The detectors a scan runs, one HogQL query each.
 *
 * Stored only inside `ux_signal_scans.metadata` and on findings' evidence, never
 * as a column of its own — a detector name is provenance for a human reading a
 * finding, not something the platform queries by.
 *
 * Each detector declares a *prior* (bug vs improvement) rather than a verdict:
 * the triage pass may reclassify, because the same signal reads differently with
 * context. A rage-click cluster on a control that does nothing is a bug; the same
 * cluster on a control that works but is slow is an improvement.
 */
export enum UxSignalDetector {
  /** api_error_occurred volume on one endpoint, against its own weekly baseline. */
  API_ERROR_SPIKE = 'api_error_spike',
  /** One session hitting the same endpoint error repeatedly — a retry dead end. */
  ERROR_LOOP = 'error_loop',
  /** PostHog $rageclick, grouped by route + element. */
  RAGE_CLICK_CLUSTER = 'rage_click_cluster',
  /** PostHog $dead_click — clicks on things that are not interactive. */
  DEAD_CLICK_CLUSTER = 'dead_click_cluster',
  /** Sessions whose last event is a pageleave on one route. */
  ROUTE_ABANDONMENT = 'route_abandonment',
  /** search_performed with result_count = 0. */
  ZERO_RESULT_SEARCH = 'zero_result_search',
  /** A start event far outnumbering its completion event. */
  FUNNEL_DROPOFF = 'funnel_dropoff',
}

/**
 * What a detector's signal most likely is, before triage sees it in context.
 * Bug-shaped signals head for Bug Hunter; improvement-shaped ones for the
 * suggestions queue.
 */
export enum UxSignalKind {
  BUG = 'bug',
  IMPROVEMENT = 'improvement',
}

/** What started a scan. Manual runs carry the admin's id in `started_by`. */
export enum UxSignalScanTrigger {
  SCHEDULED = 'scheduled',
  MANUAL = 'manual',
}

/**
 * A scan's lifecycle. RUNNING doubles as the concurrency guard — a second scan
 * refuses to start while a young RUNNING row exists, so a slow PostHog query
 * cannot be overlapped by the hourly tick.
 */
export enum UxSignalScanStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
