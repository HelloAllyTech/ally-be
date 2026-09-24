import { NotFoundException } from '@nestjs/common';

import {
  BUG_HUNT_BREADTH_METADATA_KEY,
  BugHunterTelemetryService,
} from '../bug-hunter-telemetry.service';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';
import { BugHuntPhaseTiming } from '../../entity/bug-hunt-phase.entity';
import {
  BugHuntLookupKind,
  BugHuntPhase,
  BugHuntPhaseEvent,
} from '../../enum/bug-hunt-telemetry.enum';

const runRow = (overrides: Partial<BugHuntRun> = {}): BugHuntRun =>
  ({
    id: 'run-1',
    repo: 'ally-be',
    metadata: null,
    totalInputTokens: 1200,
    totalOutputTokens: 300,
    createdAt: new Date('2026-09-23T02:15:00.000Z'),
    finishedAt: new Date('2026-09-23T03:05:00.000Z'),
    ...overrides,
  }) as BugHuntRun;

describe('BugHunterTelemetryService', () => {
  let service: BugHunterTelemetryService;
  let bugHunterService: { getRun: jest.Mock };
  let runRepository: {
    update: jest.Mock;
    breadthStats: jest.Mock;
  };
  let phaseRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    listForRun: jest.Mock;
    durationStats: jest.Mock;
  };
  let lookupRepository: {
    create: jest.Mock;
    save: jest.Mock;
    listForRun: jest.Mock;
    kindStats: jest.Mock;
  };

  beforeEach(() => {
    bugHunterService = { getRun: jest.fn().mockResolvedValue(runRow()) };
    runRepository = {
      update: jest.fn().mockResolvedValue(undefined),
      breadthStats: jest.fn(),
    };
    phaseRepository = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => row),
      listForRun: jest.fn().mockResolvedValue([]),
      durationStats: jest.fn().mockResolvedValue([]),
    };
    lookupRepository = {
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => ({ id: 'lookup-1', ...row })),
      listForRun: jest.fn().mockResolvedValue([]),
      kindStats: jest.fn().mockResolvedValue([]),
    };
    service = new BugHunterTelemetryService(
      bugHunterService as never,
      runRepository as never,
      phaseRepository as never,
      lookupRepository as never,
    );
  });

  describe('recordPhase', () => {
    it('opens a phase on started, counting the first start', async () => {
      const at = new Date('2026-09-23T02:16:00.000Z');
      const row = await service.recordPhase(
        'run-1',
        { phase: BugHuntPhase.DISCOVER, event: BugHuntPhaseEvent.STARTED },
        at,
      );

      expect(row).toMatchObject({
        runId: 'run-1',
        phase: BugHuntPhase.DISCOVER,
        startedAt: at,
        metadata: { startedCount: 1 },
      });
      expect(row.finishedAt).toBeUndefined();
    });

    it('closes a phase on finished and stamps the duration from the first start', async () => {
      phaseRepository.findOne.mockResolvedValue({
        runId: 'run-1',
        phase: BugHuntPhase.VERIFY,
        startedAt: new Date('2026-09-23T02:30:00.000Z'),
        metadata: { startedCount: 1 },
      } as unknown as BugHuntPhaseTiming);

      const row = await service.recordPhase(
        'run-1',
        {
          phase: BugHuntPhase.VERIFY,
          event: BugHuntPhaseEvent.FINISHED,
          summary: '9 findings, 2 refuted',
        },
        new Date('2026-09-23T02:42:30.000Z'),
      );

      expect(row.durationMs).toBe(12.5 * 60 * 1000);
      expect(row.summary).toBe('9 findings, 2 refuted');
    });

    it('re-opens a finished phase on a repeated start rather than resetting it', async () => {
      // The fix protocol legitimately re-enters FIX on a second attempt. The
      // honest duration of "fixing" is first entry to last exit, so the
      // original start is kept and the row is reopened for the next finish.
      const firstStart = new Date('2026-09-23T02:50:00.000Z');
      phaseRepository.findOne.mockResolvedValue({
        runId: 'run-1',
        phase: BugHuntPhase.FIX,
        startedAt: firstStart,
        finishedAt: new Date('2026-09-23T02:58:00.000Z'),
        durationMs: 8 * 60 * 1000,
        metadata: { startedCount: 1 },
      } as unknown as BugHuntPhaseTiming);

      const row = await service.recordPhase(
        'run-1',
        { phase: BugHuntPhase.FIX, event: BugHuntPhaseEvent.STARTED },
        new Date('2026-09-23T03:00:00.000Z'),
      );

      expect(row.startedAt).toEqual(firstStart);
      expect(row.finishedAt).toBeNull();
      expect(row.durationMs).toBeNull();
      expect(row.metadata).toEqual({ startedCount: 2 });
    });

    it('records a finish the agent never opened as a zero-length phase, not a 404', async () => {
      const at = new Date('2026-09-23T03:04:00.000Z');
      const row = await service.recordPhase(
        'run-1',
        { phase: BugHuntPhase.CLOSE, event: BugHuntPhaseEvent.FINISHED },
        at,
      );

      expect(row.startedAt).toEqual(at);
      expect(row.finishedAt).toEqual(at);
      expect(row.durationMs).toBe(0);
      expect(row.metadata).toEqual({ startedCount: 0 });
    });

    it('refuses a run that does not exist', async () => {
      bugHunterService.getRun.mockRejectedValue(new NotFoundException());
      await expect(
        service.recordPhase('missing', {
          phase: BugHuntPhase.DISCOVER,
          event: BugHuntPhaseEvent.STARTED,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(phaseRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('recordLookup', () => {
    it('never throws — telemetry must not fail the request that produced the data', async () => {
      lookupRepository.save.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordLookup('run-1', {
          kind: BugHuntLookupKind.PROD_LOGS,
          itemCount: 3,
        }),
      ).resolves.toBeNull();
    });

    it('stores relevance to four places and leaves unreported fields null', async () => {
      await service.recordLookup('run-1', {
        kind: BugHuntLookupKind.MEMORY,
        itemCount: 3,
        chars: 1800,
        latencyMs: 42,
        relevance: 0.87654,
        usedCount: 2,
      });

      expect(lookupRepository.create).toHaveBeenCalledWith({
        runId: 'run-1',
        kind: BugHuntLookupKind.MEMORY,
        itemCount: 3,
        chars: 1800,
        latencyMs: 42,
        relevance: '0.8765',
        usedCount: 2,
        metadata: null,
      });
    });
  });

  describe('timed', () => {
    it('returns the fetched result and records items, size and latency when a run is named', async () => {
      const result = await service.timed(
        'run-1',
        BugHuntLookupKind.WEB_LOGS,
        async () => [{ type: 'TypeError' }, { type: 'RangeError' }],
        (rows) => ({ itemCount: rows.length, chars: 40 }),
        { repo: 'ally-web' },
      );

      expect(result).toHaveLength(2);
      expect(lookupRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          kind: BugHuntLookupKind.WEB_LOGS,
          itemCount: 2,
          chars: 40,
          metadata: { repo: 'ally-web' },
        }),
      );
      expect(
        lookupRepository.create.mock.calls[0][0].latencyMs,
      ).toBeGreaterThanOrEqual(0);
    });

    it('records a null result as zero items — "asked, nothing there" is a real answer', async () => {
      await service.timed(
        'run-1',
        BugHuntLookupKind.PROD_LOGS,
        async () => null,
        (rows: unknown[] | null) => ({
          itemCount: rows ? rows.length : 0,
          chars: 0,
        }),
      );

      expect(lookupRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ itemCount: 0, chars: 0 }),
      );
    });

    it('records nothing when no run is named, so older workflow copies keep working unmeasured', async () => {
      const result = await service.timed(
        undefined,
        BugHuntLookupKind.PROD_LOGS,
        async () => [1, 2, 3],
        (rows) => ({ itemCount: rows.length, chars: 3 }),
      );

      expect(result).toEqual([1, 2, 3]);
      expect(lookupRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('recordContext', () => {
    it('merges the code-scope summary into the run metadata without clobbering other keys', async () => {
      bugHunterService.getRun.mockResolvedValue(
        runRow({ metadata: { cliReportedCostUsd: 1.25 } }),
      );

      await service.recordContext('run-1', {
        deep: false,
        commits: 7,
        filesInScope: 23,
        linesInScope: 640,
      });

      expect(runRepository.update).toHaveBeenCalledWith('run-1', {
        metadata: {
          cliReportedCostUsd: 1.25,
          [BUG_HUNT_BREADTH_METADATA_KEY]: {
            deep: false,
            commits: 7,
            filesInScope: 23,
            linesInScope: 640,
          },
        },
      });
    });
  });

  describe('getRunTelemetry', () => {
    it('assembles phases, lookups, breadth and run-level totals', async () => {
      bugHunterService.getRun.mockResolvedValue(
        runRow({
          metadata: {
            [BUG_HUNT_BREADTH_METADATA_KEY]: {
              deep: true,
              filesInScope: 400,
            },
          },
        }),
      );
      phaseRepository.listForRun.mockResolvedValue([
        {
          phase: BugHuntPhase.DISCOVER,
          startedAt: new Date('2026-09-23T02:16:00.000Z'),
          finishedAt: new Date('2026-09-23T02:40:00.000Z'),
          durationMs: 24 * 60 * 1000,
          summary: null,
          metadata: { startedCount: 1 },
        },
      ]);
      lookupRepository.listForRun.mockResolvedValue([
        {
          kind: BugHuntLookupKind.PROD_LOGS,
          itemCount: 12,
          chars: 3000,
          latencyMs: 410,
          relevance: null,
          usedCount: null,
          createdAt: new Date('2026-09-23T02:17:00.000Z'),
        },
        {
          kind: BugHuntLookupKind.MEMORY,
          itemCount: 3,
          chars: 900,
          latencyMs: 55,
          relevance: '0.8100',
          usedCount: 2,
          createdAt: new Date('2026-09-23T02:50:00.000Z'),
        },
      ]);

      const telemetry = await service.getRunTelemetry('run-1');

      expect(telemetry.phases).toHaveLength(1);
      expect(telemetry.phases[0].durationMs).toBe(24 * 60 * 1000);
      expect(telemetry.lookups[1].relevance).toBe(0.81);
      expect(telemetry.breadth).toEqual({
        deep: true,
        commits: null,
        filesInScope: 400,
        linesInScope: null,
        packChars: null,
        lookupItems: 15,
        lookupChars: 3900,
      });
      expect(telemetry.totalInputTokens).toBe(1200);
      expect(telemetry.totalDurationMs).toBe(50 * 60 * 1000);
    });

    it('leaves the total duration null while the run is still open', async () => {
      bugHunterService.getRun.mockResolvedValue(runRow({ finishedAt: null }));
      const telemetry = await service.getRunTelemetry('run-1');
      expect(telemetry.totalDurationMs).toBeNull();
    });
  });

  describe('pipelineMetrics', () => {
    it('fans out to the three aggregates over the same window', async () => {
      phaseRepository.durationStats.mockResolvedValue([
        {
          phase: BugHuntPhase.VERIFY,
          samples: 6,
          unfinished: 1,
          medianMs: 600000,
          p90Ms: 900000,
        },
      ]);
      lookupRepository.kindStats.mockResolvedValue([
        {
          kind: BugHuntLookupKind.PROD_LOGS,
          calls: 7,
          hitRate: 0.42,
          medianLatencyMs: 380,
          avgItems: 4,
          avgChars: 1200,
          avgRelevance: null,
          usedShare: null,
        },
      ]);
      runRepository.breadthStats.mockResolvedValue({
        runsReporting: 5,
        avgFilesInScope: 20,
        avgLinesInScope: 500,
        avgCommits: 6,
        avgPackChars: null,
        deepShare: 0.2,
      });

      const metrics = await service.pipelineMetrics(14);

      expect(metrics.windowDays).toBe(14);
      expect(metrics.phases[0].unfinished).toBe(1);
      expect(metrics.lookups[0].hitRate).toBe(0.42);
      expect(metrics.breadth.runsReporting).toBe(5);
      const since = phaseRepository.durationStats.mock.calls[0][0] as Date;
      expect(lookupRepository.kindStats).toHaveBeenCalledWith(since);
      expect(runRepository.breadthStats).toHaveBeenCalledWith(since);
      expect(Date.now() - since.getTime()).toBeGreaterThanOrEqual(
        14 * 24 * 60 * 60 * 1000 - 1000,
      );
    });
  });
});
