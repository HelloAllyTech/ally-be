import {
  FixDossierAttempt,
  FixDossierSession,
} from '../constants/bug-fix-dossier';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';

/** How many earlier sessions, and how many raw events per session, a case file carries. */
export const DOSSIER_MAX_SESSIONS = 3;
export const DOSSIER_MAX_EVENTS_PER_SESSION = 8;

/** Event stages that describe what a fix session did, in the order a reader wants them. */
const SESSION_STAGES = new Set<string>([
  BugHuntEventStage.SESSION_DISPATCHED,
  BugHuntEventStage.FIX_ATTEMPT,
  BugHuntEventStage.TEST_WRITTEN,
  BugHuntEventStage.DOC_UPDATED,
  BugHuntEventStage.PR_OPENED,
  BugHuntEventStage.MERGED,
  BugHuntEventStage.ESCALATED,
  BugHuntEventStage.ERROR,
  BugHuntEventStage.CANCELLED,
]);

/** What a session ended as, from the last stage that says so. */
const OUTCOME_BY_STAGE: Partial<Record<string, string>> = {
  [BugHuntEventStage.MERGED]: 'merged',
  [BugHuntEventStage.PR_OPENED]: 'with a PR open',
  [BugHuntEventStage.CANCELLED]: 'cancelled by an admin',
  [BugHuntEventStage.ERROR]: 'with an error',
  [BugHuntEventStage.ESCALATED]: 'escalated',
};

/**
 * Earlier fix sessions on a finding, from its timeline.
 *
 * Grouped by run, because a session IS a run: one dispatch, one runner, one
 * outcome. The current run is excluded (it has done nothing yet), as are
 * events with no run — the release lifecycle and admin edits land runless
 * and describe the bug's life after a fix, not an attempt at one.
 *
 * Structured `fix_attempt` payloads (the protocol asks for `attempt`,
 * `hypothesis`, `changedFiles`, `check`, `result`, `failure`) become
 * `attempts`; everything else stays a raw event line, so sessions from before
 * the protocol asked for structure are still told.
 */
export const groupSessions = (
  events: BugHuntEvent[],
  currentRunId?: string,
): FixDossierSession[] => {
  const byRun = new Map<string, BugHuntEvent[]>();
  for (const event of events) {
    if (!event.runId || event.runId === currentRunId) continue;
    if (!SESSION_STAGES.has(event.stage)) continue;
    const list = byRun.get(event.runId) ?? [];
    list.push(event);
    byRun.set(event.runId, list);
  }

  const sessions: FixDossierSession[] = [];
  byRun.forEach((list, runId) => {
    const ordered = [...list].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    // A run that only dispatched, or only reported a find, is not an attempt.
    if (!ordered.some((e) => e.stage !== BugHuntEventStage.SESSION_DISPATCHED))
      return;

    const attempts: FixDossierAttempt[] = [];
    const raw: FixDossierSession['events'] = [];
    for (const event of ordered) {
      if (event.stage === BugHuntEventStage.SESSION_DISPATCHED) continue;
      const attempt =
        event.stage === BugHuntEventStage.FIX_ATTEMPT
          ? parseAttempt(event.payload)
          : null;
      if (attempt) attempts.push(attempt);
      else
        raw.push({
          stage: event.stage,
          summary: event.summary,
          at: event.createdAt,
        });
    }

    const last = [...ordered]
      .reverse()
      .find((e) => OUTCOME_BY_STAGE[e.stage] !== undefined);
    sessions.push({
      runId,
      startedAt: ordered[0].createdAt,
      outcome: last
        ? OUTCOME_BY_STAGE[last.stage]!
        : 'without a recorded outcome',
      attempts,
      events: raw.slice(-DOSSIER_MAX_EVENTS_PER_SESSION),
    });
  });

  return sessions
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, DOSSIER_MAX_SESSIONS);
};

/** A `fix_attempt` payload in the shape the protocol asks for, or null when the event predates it. */
export const parseAttempt = (
  payload: Record<string, any> | null | undefined,
): FixDossierAttempt | null => {
  if (!payload || typeof payload !== 'object') return null;
  const hasStructure =
    'hypothesis' in payload ||
    'changedFiles' in payload ||
    'result' in payload ||
    'failure' in payload;
  if (!hasStructure) return null;
  return {
    attempt: typeof payload.attempt === 'number' ? payload.attempt : null,
    hypothesis:
      typeof payload.hypothesis === 'string' ? payload.hypothesis : null,
    changedFiles: Array.isArray(payload.changedFiles)
      ? payload.changedFiles.filter((f: unknown) => typeof f === 'string')
      : [],
    check: typeof payload.check === 'string' ? payload.check : null,
    result: typeof payload.result === 'string' ? payload.result : null,
    failure: typeof payload.failure === 'string' ? payload.failure : null,
  };
};
