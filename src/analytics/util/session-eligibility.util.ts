/**
 * The single answer to "which scenario sessions count?" for evaluation and
 * analytics. Today three code paths answer it three different ways (session
 * logs exclude preview+seed, the drift judge excludes only preview, the
 * platform aggregates exclude nothing) — new code MUST use this predicate so
 * the divergence stops growing; legacy queries migrate opportunistically.
 *
 * `alias` is the scenario_sessions table alias in the calling query.
 */
export function countableSessionPredicate(alias = 's'): string {
  return (
    `${alias}."roomId" NOT LIKE 'preview-%' ` +
    `AND ${alias}."roomId" NOT LIKE 'seed-room-%'`
  );
}

/**
 * The single answer to "how long was this session?" in MILLISECONDS net of
 * paused time, for any query joining scenario_sessions to
 * scenario_session_details.
 *
 * Prefers the persisted `callDuration`, and falls back to the session window
 * minus paused time when it is missing or zero — the same resolution order
 * the roleplay session-logs reader already applies
 * (RoleplaySessionLogsService.resolveDurationSeconds), so the dashboards and
 * the logs cannot disagree about the same session.
 *
 * The fallback exists because `callDuration` was historically written by only
 * one of the several session-end paths, which read as zero practice minutes on
 * every surface that summed it while Roleplay Logs showed the real duration
 * (migration 1930 backfills the rows that predate the fix). Sessions still
 * running, or missing an endpoint, contribute NULL — never a partial duration.
 *
 * `sessionAlias`/`detailsAlias` are the table aliases in the calling query.
 */
export function sessionDurationMsExpr(
  sessionAlias = 's',
  detailsAlias = 'd',
): string {
  return (
    `CASE WHEN COALESCE(${detailsAlias}."callDuration", 0) > 0 ` +
    `THEN ${detailsAlias}."callDuration"::bigint ` +
    `WHEN ${sessionAlias}."startedAt" IS NOT NULL ` +
    `AND ${sessionAlias}."endedAt" IS NOT NULL ` +
    `THEN GREATEST(0, (EXTRACT(EPOCH FROM (${sessionAlias}."endedAt" - ` +
    `${sessionAlias}."startedAt")) * 1000 - ` +
    `COALESCE(${sessionAlias}."totalPausedMs", 0))::bigint) ` +
    `ELSE NULL END`
  );
}
