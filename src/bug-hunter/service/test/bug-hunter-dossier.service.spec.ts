import {
  BugHunterDossierService,
  groupSessions,
} from '../bug-hunter-dossier.service';
import { BugCaseBudgetService } from '../bug-case-budget.service';
import { BugCaseFileService } from '../bug-case-file.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugHuntEvent } from '../../entity/bug-hunt-event.entity';
import {
  BugFindingSource,
  BugFindingStatus,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntLookupKind } from '../../enum/bug-hunt-telemetry.enum';

const at = (iso: string) => new Date(iso);

const event = (over: Partial<BugHuntEvent>): BugHuntEvent =>
  ({
    id: 'e',
    runId: 'run-old',
    repo: 'ally-be',
    stage: BugHuntEventStage.FIX_ATTEMPT,
    summary: 'tried something',
    payload: null,
    findingId: 'f-1',
    createdAt: at('2026-09-26T01:00:00.000Z'),
    ...over,
  }) as BugHuntEvent;

const finding = (over: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-be',
    source: BugFindingSource.CODE_REVIEW,
    title: 'Scheduler drops jobs when Redis reconnects',
    description: 'Jobs queued during a reconnect are lost.',
    originalDescription: null,
    file: 'src/scheduler/queue.ts',
    symbol: 'requeueOnReconnect',
    evidence: null,
    severity: null,
    proven: false,
    touchesGuardedPath: false,
    status: BugFindingStatus.APPROVED,
    metadata: null,
    createdAt: at('2026-09-20T00:00:00.000Z'),
    updatedAt: at('2026-09-20T00:00:00.000Z'),
    ...over,
  }) as BugFinding;

describe('groupSessions', () => {
  it("groups a finding's events into sessions by run, newest first, leaving the current run out", () => {
    const sessions = groupSessions(
      [
        event({
          runId: 'run-a',
          stage: BugHuntEventStage.SESSION_DISPATCHED,
          createdAt: at('2026-09-24T01:00:00.000Z'),
        }),
        event({
          runId: 'run-a',
          stage: BugHuntEventStage.ERROR,
          summary: 'could not reproduce',
          createdAt: at('2026-09-24T01:20:00.000Z'),
        }),
        event({
          runId: 'run-b',
          stage: BugHuntEventStage.FIX_ATTEMPT,
          createdAt: at('2026-09-26T01:00:00.000Z'),
        }),
        event({
          runId: 'run-b',
          stage: BugHuntEventStage.PR_OPENED,
          summary: 'opened a PR',
          createdAt: at('2026-09-26T01:40:00.000Z'),
        }),
        // The run that is asking for the dossier has done nothing yet.
        event({
          runId: 'run-now',
          stage: BugHuntEventStage.SESSION_DISPATCHED,
          createdAt: at('2026-09-27T01:00:00.000Z'),
        }),
        // Runless events (release lifecycle, admin edits) are not attempts.
        event({
          runId: null,
          stage: BugHuntEventStage.ERROR,
          summary: 'release went red',
          createdAt: at('2026-09-27T02:00:00.000Z'),
        }),
      ],
      'run-now',
    );
    expect(sessions.map((s) => s.runId)).toEqual(['run-b', 'run-a']);
    expect(sessions[0].outcome).toBe('with a PR open');
    expect(sessions[1].outcome).toBe('with an error');
    expect(sessions[1].events.map((e) => e.summary)).toEqual([
      'could not reproduce',
    ]);
  });

  it('turns a structured fix_attempt payload into an attempt record and leaves free text as an event', () => {
    const [session] = groupSessions([
      event({
        payload: {
          attempt: 1,
          hypothesis: 'listener registered too early',
          changedFiles: ['src/scheduler/queue.ts', 42],
          check: 'full suite',
          result: 'failed',
          failure: 'expected 3 jobs, received 2',
        },
      }),
      event({
        summary: 'tried a second thing',
        payload: { model: 'x' },
        createdAt: at('2026-09-26T01:30:00.000Z'),
      }),
    ]);
    expect(session.attempts).toEqual([
      {
        attempt: 1,
        hypothesis: 'listener registered too early',
        changedFiles: ['src/scheduler/queue.ts'],
        check: 'full suite',
        result: 'failed',
        failure: 'expected 3 jobs, received 2',
      },
    ]);
    expect(session.events.map((e) => e.summary)).toEqual([
      'tried a second thing',
    ]);
  });

  it('ignores a run that only dispatched and never did anything', () => {
    expect(
      groupSessions([event({ stage: BugHuntEventStage.SESSION_DISPATCHED })]),
    ).toEqual([]);
  });
});

describe('BugHunterDossierService', () => {
  let findingRepository: {
    findOne: jest.Mock;
    listShippedSimilar: jest.Mock;
    listOpenInFile: jest.Mock;
  };
  let eventRepository: { listForFinding: jest.Mock };
  let bugFindingService: { enrich: jest.Mock };
  let memoryService: { search: jest.Mock };
  let telemetryService: { timed: jest.Mock };
  let service: BugHunterDossierService;

  beforeEach(() => {
    findingRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      listShippedSimilar: jest.fn().mockResolvedValue([]),
      listOpenInFile: jest.fn().mockResolvedValue([]),
    };
    eventRepository = { listForFinding: jest.fn().mockResolvedValue([]) };
    bugFindingService = {
      enrich: jest.fn(async (rows: BugFinding[]) =>
        rows.map((r) => Object.assign(r, { report: null })),
      ),
    };
    memoryService = { search: jest.fn().mockResolvedValue([]) };
    telemetryService = {
      timed: jest.fn((_runId, _kind, fetch) => fetch()),
    };
    // The dossier now takes sessions, verdicts, lineage and the post-mortem
    // from the case file (OPP-0775); a real one over the same mocks keeps
    // every assertion below watching the same inputs it always did.
    service = new BugHunterDossierService(
      findingRepository as never,
      new BugCaseFileService(
        eventRepository as never,
        bugFindingService as never,
        new BugCaseBudgetService({} as never),
      ),
      memoryService as never,
      telemetryService as never,
    );
  });

  it('assembles every section from the finding and its neighbours', async () => {
    findingRepository.findOne.mockResolvedValue(
      finding({
        id: 'f-0',
        status: BugFindingStatus.RELEASED,
        prUrl: 'https://github.com/helloallytech/ally-be/pull/880',
        releaseTag: 'v1.140.2',
        releasedAt: at('2026-09-10T00:00:00.000Z'),
      }),
    );
    findingRepository.listShippedSimilar.mockResolvedValue([
      finding({
        id: 'f-5',
        title: 'Neighbour fix',
        prUrl: 'https://x/pull/812',
        releasedAt: at('2026-09-01T00:00:00.000Z'),
      }),
    ]);
    findingRepository.listOpenInFile.mockResolvedValue([
      finding({
        id: 'f-6',
        title: 'Queue metrics undercount',
        status: BugFindingStatus.NEW,
      }),
    ]);
    memoryService.search.mockResolvedValue([
      {
        id: 'm',
        body: 'ally-be: scheduler tests need a live Redis.',
        tags: ['fix-gotcha'],
        repos: ['ally-be'],
        pinned: false,
        similarity: 0.71,
      },
    ]);
    eventRepository.listForFinding.mockResolvedValue([
      event({
        runId: 'run-old',
        stage: BugHuntEventStage.ERROR,
        summary: 'suite still red',
      }),
    ]);

    const dossier = await service.build(
      finding({
        metadata: {
          confidence: 0.62,
          verifierVotes: [
            { refuted: false, certainty: 0.62, reason: 'plausible' },
          ],
          regressionOf: 'f-0',
          rediscoveredCount: 2,
          postmortem: { rootCause: 'listener re-registered too late' },
        },
      }),
      'ally-be',
      'run-now',
    );

    expect(dossier.verification).toEqual({
      confidence: 0.62,
      votes: [{ refuted: false, certainty: 0.62, reason: 'plausible' }],
    });
    expect(dossier.lineage.regressionOf).toMatchObject({
      id: 'f-0',
      releaseTag: 'v1.140.2',
      prUrl: expect.stringContaining('880'),
    });
    expect(dossier.lineage.rediscoveredCount).toBe(2);
    expect(dossier.postmortem).toEqual({
      rootCause: 'listener re-registered too late',
    });
    expect(dossier.previousSessions).toHaveLength(1);
    expect(dossier.similarShipped[0]).toMatchObject({
      id: 'f-5',
      prUrl: 'https://x/pull/812',
    });
    expect(dossier.openNeighbours).toEqual([
      { id: 'f-6', title: 'Queue metrics undercount', status: 'new' },
    ]);
    expect(dossier.notebook[0]).toMatchObject({
      tags: ['fix-gotcha'],
      similarity: 0.71,
    });

    expect(findingRepository.listShippedSimilar).toHaveBeenCalledWith(
      'ally-be',
      'src/scheduler/queue.ts',
      'requeueOnReconnect',
      'f-1',
      3,
    );
    // The notebook lookup is recorded against the run, like the sweep's.
    expect(telemetryService.timed).toHaveBeenCalledWith(
      'run-now',
      BugHuntLookupKind.MEMORY,
      expect.any(Function),
      expect.any(Function),
      { source: 'fix_dossier' },
    );
  });

  it('carries the reporter only for a human-reported bug', async () => {
    bugFindingService.enrich.mockImplementation(async (rows: BugFinding[]) =>
      rows.map((r) =>
        Object.assign(r, {
          report: {
            opportunityId: 'o',
            reporterSource: 'consumer',
            reportedBy: 7,
            reportedByName: 'Priya',
            tenantId: 't',
            reporterContext: { screen: 'Roleplay' },
            reportedAt: at('2026-09-25T00:00:00.000Z'),
          },
        }),
      ),
    );
    const reported = await service.build(
      finding({ source: BugFindingSource.REPORTED_BUG }),
      'ally-be',
    );
    expect(reported.reporter).toMatchObject({
      source: 'consumer',
      name: 'Priya',
      context: { screen: 'Roleplay' },
    });

    const agentFound = await service.build(finding(), 'ally-be');
    expect(agentFound.reporter).toBeNull();
  });

  it('still returns a dossier when a side-lookup fails — a fix session must never fail to start over it', async () => {
    memoryService.search.mockRejectedValue(new Error('ally-ai is down'));
    findingRepository.listShippedSimilar.mockRejectedValue(new Error('boom'));

    const dossier = await service.build(finding(), 'ally-be', 'run-now');

    expect(dossier.finding.id).toBe('f-1');
    expect(dossier.notebook).toEqual([]);
    expect(dossier.similarShipped).toEqual([]);
  });

  it('skips the file-scoped lookups when the finding names no file', async () => {
    await service.build(finding({ file: null, symbol: null }), 'ally-be');
    expect(findingRepository.listOpenInFile).not.toHaveBeenCalled();
    expect(findingRepository.listShippedSimilar).toHaveBeenCalledWith(
      'ally-be',
      null,
      null,
      'f-1',
      3,
    );
  });
});
