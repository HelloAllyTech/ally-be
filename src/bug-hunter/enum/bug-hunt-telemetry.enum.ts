/**
 * The phases a Bug Hunter run reports the boundaries of, so each one's
 * wall-clock can be measured on its own — see `BugHunterTelemetryService`.
 *
 * Two protocols share one list. A sweep walks DISCOVER → VERIFY → FIX → CLOSE
 * (see `buildSweepPrompt`); a fix session walks REPRODUCE → FIX → SUITE → PR
 * (see `buildFixSessionPrompt`). FIX is deliberately the same value in both:
 * "how long did the agent spend writing the change" is the same question
 * whichever protocol asked it, and a per-phase chart should not split it.
 *
 * Stored as `character varying` with a CHECK constraint, per repo convention
 * (not a Postgres enum — see AnalyticsSuggestionStatus for why). Adding a
 * value here means extending `CHK_bug_hunt_phases_phase` in a migration AND
 * the row in `check-constraints-cover-enums.spec.ts`.
 */
export enum BugHuntPhase {
  DISCOVER = 'discover',
  VERIFY = 'verify',
  FIX = 'fix',
  CLOSE = 'close',
  REPRODUCE = 'reproduce',
  SUITE = 'suite',
  PR = 'pr',
}

/** Whether the agent is opening or closing a phase — the two events a boundary can be. */
export enum BugHuntPhaseEvent {
  STARTED = 'started',
  FINISHED = 'finished',
}

/**
 * Every source of context Bug Hunter hands the agent, recorded per fetch so
 * the run can say what the agent was shown and how long it took to get.
 *
 * The first five are fetched from ally-be's own pipeline endpoints and are
 * recorded server-side the moment they are served (see
 * `BugHunterTelemetryService.timed`) — the agent does nothing extra. REPO_MAP
 * and MEMORY are reserved for the knowledge-pack and memory-search work that
 * follows: those lookups happen inside the agent's own tools, so they arrive
 * through `POST runs/:id/lookups` instead, carrying a relevance score and how
 * many of the returned entries the agent went on to use.
 *
 * Same CHECK-constraint convention as `BugHuntPhase`: extend
 * `CHK_bug_hunt_context_lookups_kind` and the coverage spec together.
 */
export enum BugHuntLookupKind {
  PROD_LOGS = 'prod_logs',
  WEB_LOGS = 'web_logs',
  REPORTED_BUGS = 'reported_bugs',
  APPROVED_FINDINGS = 'approved_findings',
  KNOWN_NON_BUGS = 'known_non_bugs',
  REPO_MAP = 'repo_map',
  MEMORY = 'memory',
}
