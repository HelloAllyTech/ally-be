import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { BugFindingSeverity } from 'src/bug-hunter/enum/bug-finding.enum';
import { AnalyticsSuggestion } from 'src/analytics-suggestions/entity/analytics-suggestion.entity';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';

import { UxSignalsService } from '../ux-signals.service';
import { UxSignalDetectorService } from '../ux-signal-detector.service';
import { UxSignalsAiService } from '../ux-signals-ai.service';
import { UxSignalWriterService } from '../ux-signal-writer.service';
import { UxSignalScan } from '../../entity/ux-signal-scan.entity';
import {
  UxSignalDetector,
  UxSignalKind,
  UxSignalScanStatus,
  UxSignalScanTrigger,
} from '../../enum/ux-signal.enum';
import { UxSignal } from '../../ux-signals.types';

/**
 * The orchestrator owns the guarantees that keep the pipeline an amplifier rather
 * than a nuisance: it never files unvalidated model taxonomy, it caps what one run
 * can add to a human queue, it distinguishes "found nothing" from "went wrong",
 * and it will not overlap itself.
 */
describe('UxSignalsService', () => {
  let service: UxSignalsService;
  let detect: jest.Mock;
  let triage: jest.Mock;
  let write: jest.Mock;
  let scanRows: UxSignalScan[];
  let savedScan: Record<string, unknown>;
  let saveScan: jest.Mock;
  let updateScan: jest.Mock;
  let countScans: jest.Mock;
  let posthogEnabled: boolean;

  const signal = (): UxSignal => ({
    detector: UxSignalDetector.RAGE_CLICK_CLUSTER,
    defaultKind: UxSignalKind.BUG,
    route: '/inbox',
    target: 'element "Retry"',
    metric: { name: 'rage clicks', value: 9, threshold: 5 },
    window: { from: '2026-08-20', to: '2026-08-27' },
    sessions: 5,
    users: 5,
    examples: ['clicked control labelled "Retry"'],
  });

  beforeEach(async () => {
    posthogEnabled = true;
    scanRows = [];
    savedScan = { id: 'scan-1' };
    detect = jest
      .fn()
      .mockResolvedValue({ signals: [signal()], failedDetectors: [] });
    triage = jest.fn().mockResolvedValue([]);
    write = jest.fn().mockResolvedValue({
      findingsCreated: 0,
      suggestionsCreated: 0,
      skippedDuplicates: 0,
    });
    updateScan = jest.fn();
    countScans = jest.fn().mockResolvedValue(0);
    saveScan = jest.fn(async (row: Record<string, unknown>) => {
      savedScan = { ...row, id: 'scan-1' };
      return savedScan;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UxSignalsService,
        {
          provide: AppConfigService,
          useValue: {
            get posthog() {
              return { enabled: posthogEnabled };
            },
          },
        },
        { provide: UxSignalDetectorService, useValue: { detect } },
        {
          provide: UxSignalsAiService,
          useValue: { triage, model: 'claude-test' },
        },
        { provide: UxSignalWriterService, useValue: { write } },
        {
          provide: BugFindingRepository,
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: RoadmapProductGoalRepository,
          useValue: {
            findAllOrdered: jest
              .fn()
              .mockResolvedValue([{ name: 'Improve learner engagement' }]),
          },
        },
        {
          provide: getRepositoryToken(AnalyticsSuggestion),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(UxSignalScan),
          useValue: {
            create: (row: Record<string, unknown>) => row,
            save: (row: Record<string, unknown>) => saveScan(row),
            update: updateScan,
            count: countScans,
            find: jest.fn(async () => scanRows),
          },
        },
      ],
    }).compile();

    service = module.get(UxSignalsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('refuses to scan when PostHog access is not configured', async () => {
    // Every environment without a query credential would otherwise fail a
    // scheduled task once a day.
    posthogEnabled = false;
    await expect(
      service.runScan(UxSignalScanTrigger.MANUAL, 1),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('records a quiet week without spending a triage call', async () => {
    // Zero signals is a real answer, and must be distinguishable from a failure.
    detect.mockResolvedValue({ signals: [], failedDetectors: [] });

    const outcome = await service.runScan(UxSignalScanTrigger.SCHEDULED);

    expect(triage).not.toHaveBeenCalled();
    expect(outcome.signalsDetected).toBe(0);
    expect(updateScan).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({ status: UxSignalScanStatus.COMPLETED }),
    );
  });

  it('fails the scan, with the reason on the row, when triage is unparseable', async () => {
    triage.mockResolvedValue(null);

    await expect(
      service.runScan(UxSignalScanTrigger.MANUAL, 1),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(write).not.toHaveBeenCalled();
    expect(updateScan).toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({
        status: UxSignalScanStatus.FAILED,
        error: expect.stringContaining('parseable'),
      }),
    );
  });

  it('nulls a product goal the live taxonomy does not contain', async () => {
    // Unvalidated model taxonomy once polluted more than half the roadmap's goal
    // data; a plausible-sounding invented goal must never be stored.
    triage.mockResolvedValue([
      {
        kind: 'improvement',
        title: 'Resources page loses visitors',
        body: 'Most sessions end on /resources.',
        route: '/resources',
        suggestedGoal: 'Delight The Users',
      },
      {
        kind: 'improvement',
        title: 'Search finds nothing on /inbox',
        body: 'Empty searches cluster there.',
        route: '/inbox',
        suggestedGoal: 'Improve learner engagement',
      },
    ]);

    await service.runScan(UxSignalScanTrigger.MANUAL, 1);

    const items = write.mock.calls[0][0];
    expect(items[0].suggestedGoal).toBeNull();
    expect(items[1].suggestedGoal).toBe('Improve learner engagement');
  });

  it('drops an item with no title, body or route rather than inventing one', async () => {
    triage.mockResolvedValue([
      { kind: 'bug', title: '', body: 'something', route: '/inbox' },
      { kind: 'bug', title: 'A bug', body: '', route: '/inbox' },
      { kind: 'bug', title: 'A bug', body: 'something', route: '' },
      { kind: 'bug', title: 'A real bug', body: 'something', route: '/inbox' },
    ]);

    await service.runScan(UxSignalScanTrigger.MANUAL, 1);

    const items = write.mock.calls[0][0];
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('A real bug');
  });

  it('caps each kind independently so one run cannot flood a queue', async () => {
    triage.mockResolvedValue([
      ...Array.from({ length: 14 }, (_, i) => ({
        kind: 'bug',
        title: `Bug ${i}`,
        body: 'x',
        route: `/r${i}`,
      })),
      ...Array.from({ length: 14 }, (_, i) => ({
        kind: 'improvement',
        title: `Idea ${i}`,
        body: 'x',
        route: `/i${i}`,
      })),
    ]);

    await service.runScan(UxSignalScanTrigger.MANUAL, 1);

    const items = write.mock.calls[0][0];
    expect(
      items.filter((i: { kind: string }) => i.kind === UxSignalKind.BUG),
    ).toHaveLength(10);
    expect(
      items.filter(
        (i: { kind: string }) => i.kind === UxSignalKind.IMPROVEMENT,
      ),
    ).toHaveLength(10);
  });

  it('defaults an unrecognised severity to medium, never to high', async () => {
    triage.mockResolvedValue([
      {
        kind: 'bug',
        title: 'A bug',
        body: 'x',
        route: '/inbox',
        severity: 'catastrophic',
      },
    ]);

    await service.runScan(UxSignalScanTrigger.MANUAL, 1);

    expect(write.mock.calls[0][0][0].severity).toBe(BugFindingSeverity.MEDIUM);
  });

  it('refuses to start while another scan is genuinely in flight', async () => {
    countScans.mockImplementation(
      async (options: { where: { startedAt?: unknown } }) =>
        // One RUNNING row, and it is not stale (the stale count query is the one
        // carrying a startedAt predicate).
        options.where?.startedAt ? 0 : 1,
    );

    await expect(
      service.runScan(UxSignalScanTrigger.MANUAL, 1),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects the loser of two racing scans instead of running both', async () => {
    // A double-clicked "Scan now" (or a retry of a request that looked hung)
    // puts two calls in flight before either has committed its RUNNING row, so
    // both read zero in flight — the count-then-insert check cannot be what
    // separates them. The database's single-running-scan index is, and the
    // loser has to surface as the same 409 a sequential second press gets,
    // not as a raw driver error and not as a second concurrent scan.
    countScans.mockResolvedValue(0);

    let runningRows = 0;
    saveScan.mockImplementation(async (row: Record<string, unknown>) => {
      if (runningRows > 0) {
        throw Object.assign(
          new Error(
            'duplicate key value violates unique constraint ' +
              '"uq_ux_signal_scans_single_running"',
          ),
          { name: 'QueryFailedError', code: '23505' },
        );
      }
      runningRows += 1;
      return { ...row, id: 'scan-1' };
    });

    // Hold the winner inside detection so the two runs genuinely overlap.
    let releaseDetect: () => void = () => {};
    detect.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseDetect = () => resolve({ signals: [], failedDetectors: [] });
        }),
    );

    const winner = service.runScan(UxSignalScanTrigger.MANUAL, 1);
    await new Promise((resolve) => setImmediate(resolve));
    const loser = service.runScan(UxSignalScanTrigger.MANUAL, 2);

    await expect(loser).rejects.toThrow(ConflictException);
    releaseDetect();
    await expect(winner).resolves.toEqual(
      expect.objectContaining({ scanId: 'scan-1' }),
    );
    // The loser must not have spent a detector pass or a triage call.
    expect(detect).toHaveBeenCalledTimes(1);
    expect(triage).not.toHaveBeenCalled();
    // Nor may it have marked the winner's row FAILED on its way out.
    expect(updateScan).not.toHaveBeenCalledWith(
      'scan-1',
      expect.objectContaining({ status: UxSignalScanStatus.FAILED }),
    );
  });

  it('clears an abandoned RUNNING row instead of wedging forever', async () => {
    // A crash or redeploy mid-scan leaves one behind; without this the pipeline
    // stays blocked until someone notices by hand.
    countScans.mockResolvedValue(1);

    const outcome = await service.runScan(UxSignalScanTrigger.MANUAL, 1);

    expect(outcome.scanId).toBe('scan-1');
    expect(updateScan).toHaveBeenCalledWith(
      expect.objectContaining({ status: UxSignalScanStatus.RUNNING }),
      expect.objectContaining({ status: UxSignalScanStatus.FAILED }),
    );
  });

  describe('isDueForScheduledScan', () => {
    it('is due when no scan has ever run', async () => {
      scanRows = [];
      await expect(service.isDueForScheduledScan()).resolves.toBe(true);
    });

    it('is not due an hour after the last scan', async () => {
      // The task is registered hourly because there is no daily tick; the gate
      // is what makes the cadence daily.
      scanRows = [
        { startedAt: new Date(Date.now() - 3_600_000) } as UxSignalScan,
      ];
      await expect(service.isDueForScheduledScan()).resolves.toBe(false);
    });

    it('is due again after a day', async () => {
      scanRows = [
        { startedAt: new Date(Date.now() - 25 * 3_600_000) } as UxSignalScan,
      ];
      await expect(service.isDueForScheduledScan()).resolves.toBe(true);
    });

    it('is never due while PostHog access is unconfigured', async () => {
      posthogEnabled = false;
      scanRows = [];
      await expect(service.isDueForScheduledScan()).resolves.toBe(false);
    });
  });
});
