import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';
import {
  FixDossier,
  FixDossierAttempt,
  FixDossierSession,
  clipDossierText,
} from '../constants/bug-fix-dossier';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugFindingSource } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntLookupKind } from '../enum/bug-hunt-telemetry.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHuntEventRepository } from '../repository/bug-hunt-event.repository';
import { BugFindingService } from './bug-finding.service';
import { BugHunterTelemetryService } from './bug-hunter-telemetry.service';

/** How many earlier sessions, and how many raw events per session, the dossier carries. */
export const DOSSIER_MAX_SESSIONS = 3;
export const DOSSIER_MAX_EVENTS_PER_SESSION = 8;
export const DOSSIER_SIMILAR_LIMIT = 3;
export const DOSSIER_NEIGHBOUR_LIMIT = 5;
export const DOSSIER_NOTEBOOK_LIMIT = 3;

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
 * Assembles the fix dossier — everything the platform already knows about a
 * bug — for the session about to fix it. See `FixDossier` for why.
 *
 * Every lookup is best-effort: a dossier that is missing its notebook hits
 * because ally-ai was down is still worth handing over, and a fix session
 * must never fail to start because a side-lookup did. Only the finding
 * itself is required.
 */
@Injectable()
export class BugHunterDossierService {
  private readonly logger = LoggerService.getInstance(
    BugHunterDossierService.name,
  );

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly eventRepository: BugHuntEventRepository,
    private readonly bugFindingService: BugFindingService,
    private readonly memoryService: AgentMemoryService,
    private readonly telemetryService: BugHunterTelemetryService,
  ) {}

  async build(
    finding: BugFinding,
    repo: string,
    runId?: string,
  ): Promise<FixDossier> {
    const metadata = finding.metadata ?? {};

    const [enriched, events, regressionOf, similar, neighbours, notebook] =
      await Promise.all([
        this.safely('reporter', () =>
          this.bugFindingService.enrich([finding]).then((rows) => rows[0]),
        ),
        this.safely('events', () =>
          this.eventRepository.listForFinding(finding.id),
        ),
        this.safely('regression', () =>
          typeof metadata.regressionOf === 'string'
            ? this.findingRepository.findOne({
                where: { id: metadata.regressionOf },
              })
            : Promise.resolve(null),
        ),
        this.safely('similar', () =>
          this.findingRepository.listShippedSimilar(
            repo,
            finding.file,
            finding.symbol,
            finding.id,
            DOSSIER_SIMILAR_LIMIT,
          ),
        ),
        this.safely('neighbours', () =>
          finding.file
            ? this.findingRepository.listOpenInFile(
                repo,
                finding.file,
                finding.id,
                DOSSIER_NEIGHBOUR_LIMIT,
              )
            : Promise.resolve([]),
        ),
        this.safely('notebook', () =>
          this.telemetryService.timed(
            runId,
            BugHuntLookupKind.MEMORY,
            () =>
              this.memoryService.search({
                agent: AgentMemoryAgent.BUG_HUNTER,
                query: clipDossierText(
                  `${finding.title}. ${finding.description}`,
                  600,
                ),
                repo,
                limit: DOSSIER_NOTEBOOK_LIMIT,
              }),
            (hits) => ({
              itemCount: hits.length,
              chars: hits.reduce((sum, h) => sum + h.body.length, 0),
            }),
            { source: 'fix_dossier' },
          ),
        ),
      ]);

    const report = enriched?.report ?? null;
    const votes = Array.isArray(metadata.verifierVotes)
      ? (metadata.verifierVotes as Record<string, unknown>[])
      : [];
    const confidence =
      typeof metadata.confidence === 'number' ? metadata.confidence : null;

    return {
      finding: {
        id: finding.id,
        title: finding.title,
        description: finding.description,
        originalDescription: finding.originalDescription ?? null,
        file: finding.file ?? null,
        symbol: finding.symbol ?? null,
        source: finding.source,
        severity: finding.severity ?? null,
        proven: finding.proven,
        evidence: finding.evidence ?? null,
        touchesGuardedPath: finding.touchesGuardedPath,
        status: finding.status,
        createdAt: finding.createdAt,
      },
      reporter:
        finding.source === BugFindingSource.REPORTED_BUG && report
          ? {
              source: report.reporterSource,
              name: report.reportedByName,
              reportedAt: report.reportedAt,
              context: report.reporterContext,
            }
          : null,
      verification:
        confidence != null || votes.length
          ? {
              confidence,
              votes: votes.map((v) => ({
                refuted: Boolean(v.refuted),
                certainty: typeof v.certainty === 'number' ? v.certainty : null,
                reason: typeof v.reason === 'string' ? v.reason : null,
              })),
            }
          : null,
      lineage: {
        regressionOf: regressionOf
          ? {
              id: regressionOf.id,
              title: regressionOf.title,
              prUrl: regressionOf.prUrl ?? null,
              status: regressionOf.status,
              releaseTag: regressionOf.releaseTag ?? null,
              shippedAt: regressionOf.releasedAt ?? regressionOf.updatedAt,
            }
          : null,
        rediscoveredCount: Number(metadata.rediscoveredCount ?? 0) || 0,
      },
      previousSessions: groupSessions(events ?? [], runId),
      postmortem:
        metadata.postmortem && typeof metadata.postmortem === 'object'
          ? (metadata.postmortem as Record<string, unknown>)
          : null,
      similarShipped: (similar ?? []).map((s) => ({
        id: s.id,
        title: s.title,
        file: s.file ?? null,
        prUrl: s.prUrl ?? null,
        shippedAt: s.releasedAt ?? s.updatedAt,
        description: clipDossierText(s.description),
      })),
      openNeighbours: (neighbours ?? []).map((n) => ({
        id: n.id,
        title: n.title,
        status: n.status,
      })),
      notebook: (notebook ?? []).map((h) => ({
        body: h.body,
        tags: h.tags ?? [],
        similarity: h.similarity,
      })),
    };
  }

  private async safely<T>(
    what: string,
    fetch: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await fetch();
    } catch (error) {
      this.logger.warn(
        `Fix dossier: could not load ${what}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}

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
const parseAttempt = (
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
