import { SESSION_SETTLE_GRACE_MINUTES } from 'src/learn/constants/scenario-session.constants';

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
 * "This roleplay is over and its transcript has stopped changing" — the
 * precondition for any judge that reads a WHOLE transcript.
 *
 * Without it a scheduled judge that ticks while a learner is mid-roleplay
 * judges the transcript so far and writes rows, and `onlyUnjudged` then
 * excludes the session for good: the partial judgment becomes THE judgment.
 *
 * - `status = 'ENDED'`. Every way a roleplay finishes sets it, and sets it
 *   first: the learner's End button, auto-termination, the `/end-v2v` webhook
 *   and the `room_finished` webhook all go through `endScenarioSession`, and
 *   the agent's `end-of-session` message writes it too. A room that died under
 *   a live session is ENDED with `eventStatus = ABANDONED` — its transcript is
 *   as real as any other, so `eventStatus` is deliberately not filtered.
 *   `status = 'ABANDONED'` is the stuck-session sweeper reaping a row nobody
 *   ever ended; it is out here, as it is out of every analytics filter.
 * - settled for SESSION_SETTLE_GRACE_MINUTES, because trailing turns land
 *   after the end signal.
 * - `endedAt`, else `updatedAt`. `endScenarioSession` writes `status` and
 *   `endedAt` in two separate UPDATEs, so a crash between them, with no agent
 *   message to fill the gap, leaves an ENDED row with no `endedAt`.
 *   `updatedAt` is no earlier than the ENDED write, so it is a safe stand-in —
 *   and the alternative is never judging that session at all.
 */
export function settledEndedSessionPredicate(alias = 's'): string {
  return (
    `${alias}.status = 'ENDED' ` +
    `AND COALESCE(${alias}."endedAt", ${alias}."updatedAt") < ` +
    `now() - make_interval(mins => ${SESSION_SETTLE_GRACE_MINUTES})`
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
