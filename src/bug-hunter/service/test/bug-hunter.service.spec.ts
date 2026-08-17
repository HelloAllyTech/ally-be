import { ForbiddenException } from '@nestjs/common';

import { BugHunterService } from '../bug-hunter.service';
import { BugHunterSettings } from '../../entity/bug-hunter-settings.entity';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHunterMode } from '../../enum/bug-finding.enum';

const settingsRow = (
  overrides: Partial<BugHunterSettings> = {},
): BugHunterSettings =>
  ({
    id: 1,
    mode: BugHunterMode.OFF,
    updatedBy: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }) as BugHunterSettings;

const runRow = (overrides: Partial<BugHuntRun> = {}): BugHuntRun =>
  ({
    id: 'run-1',
    trigger: BugHuntTrigger.SCHEDULED,
    repo: 'ally-be',
    status: BugHuntRunStatus.RUNNING,
    finishedAt: null,
    foundCount: 0,
    autoMergedCount: 0,
    prOpenedCount: 0,
    dismissedCount: 0,
    totalTokenCostUsd: '0.0000',
    metadata: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  }) as BugHuntRun;

describe('BugHunterService', () => {
  let service: BugHunterService;
  let settingsRepository: { getSettings: jest.Mock; setMode: jest.Mock };
  let runRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    listRecent: jest.Mock;
    update: jest.Mock;
  };
  let eventRepository: {
    create: jest.Mock;
    save: jest.Mock;
    listForRun: jest.Mock;
    listSince: jest.Mock;
  };
  let notificationService: { notify: jest.Mock };
  let dataSource: { createQueryBuilder: jest.Mock };

  // Mutated by `update()` and read back by `findOne()`, so closeRun's
  // "fetch → update → re-fetch" sequence sees its own write, the way the real
  // repository would — a static mock would leave `closed.status` frozen at
  // whatever the test seeded, hiding bugs in that re-fetch.
  let currentRun: BugHuntRun;

  beforeEach(() => {
    jest.clearAllMocks();
    currentRun = runRow();

    settingsRepository = {
      getSettings: jest.fn().mockResolvedValue(settingsRow()),
      setMode: jest.fn(),
    };
    runRepository = {
      create: jest.fn((partial) => partial),
      save: jest.fn((row) => Promise.resolve(runRow(row))),
      findOne: jest.fn(() => Promise.resolve(currentRun)),
      listRecent: jest.fn(),
      update: jest.fn((_id, patch) => {
        currentRun = { ...currentRun, ...patch };
        return Promise.resolve();
      }),
    };
    eventRepository = {
      create: jest.fn((partial) => partial),
      save: jest.fn((row) => Promise.resolve({ id: 'event-1', ...row })),
      listForRun: jest.fn().mockResolvedValue([]),
      listSince: jest.fn(),
    };
    notificationService = { notify: jest.fn() };
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    dataSource = { createQueryBuilder: jest.fn().mockReturnValue(qb) };

    service = new BugHunterService(
      settingsRepository as any,
      runRepository as any,
      eventRepository as any,
      notificationService as any,
      dataSource as any,
    );
  });

  describe('the kill switch defaults off', () => {
    it('reports off when no one has ever flipped it', async () => {
      const settings = await service.getSettings();
      expect(settings.mode).toBe(BugHunterMode.OFF);
    });
  });

  describe('requireEnabledOrRecordSkip', () => {
    it('refuses to run and records a skipped_disabled run when the switch is off', async () => {
      settingsRepository.getSettings.mockResolvedValue(
        settingsRow({ mode: BugHunterMode.OFF }),
      );

      const mode = await service.requireEnabledOrRecordSkip(
        BugHuntTrigger.SCHEDULED,
        'ally-be',
      );

      expect(mode).toBeNull();
      // Spends nothing: no run left RUNNING, exactly one event recorded.
      expect(runRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: BugHuntRunStatus.SKIPPED_DISABLED }),
      );
      expect(eventRepository.save).toHaveBeenCalledTimes(1);
      expect(eventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ stage: BugHuntEventStage.SKIPPED_DISABLED }),
      );
    });

    it('allows the run to proceed in AI mode, without recording a skip', async () => {
      settingsRepository.getSettings.mockResolvedValue(
        settingsRow({ mode: BugHunterMode.AI }),
      );

      const mode = await service.requireEnabledOrRecordSkip(
        BugHuntTrigger.MANUAL,
        'ally-web',
      );

      expect(mode).toBe(BugHunterMode.AI);
      expect(runRepository.save).not.toHaveBeenCalled();
      expect(eventRepository.save).not.toHaveBeenCalled();
    });

    it('allows the run to proceed in Manual mode too, without recording a skip', async () => {
      settingsRepository.getSettings.mockResolvedValue(
        settingsRow({ mode: BugHunterMode.MANUAL }),
      );

      const mode = await service.requireEnabledOrRecordSkip(
        BugHuntTrigger.SCHEDULED,
        'ally-web',
      );

      expect(mode).toBe(BugHunterMode.MANUAL);
      expect(runRepository.save).not.toHaveBeenCalled();
    });

    it('refuses an on-demand run just as strictly as a scheduled one', async () => {
      settingsRepository.getSettings.mockResolvedValue(
        settingsRow({ mode: BugHunterMode.OFF }),
      );

      const mode = await service.requireEnabledOrRecordSkip(
        BugHuntTrigger.MANUAL,
        'ally-ai',
      );

      expect(mode).toBeNull();
    });
  });

  describe('setMode', () => {
    it('flips the switch and logs it to the timeline with no runId', async () => {
      settingsRepository.setMode.mockResolvedValue(
        settingsRow({ mode: BugHunterMode.AI, updatedBy: 42 }),
      );

      await service.setMode(BugHunterMode.AI, 42);

      expect(settingsRepository.setMode).toHaveBeenCalledWith(
        BugHunterMode.AI,
        42,
      );
      expect(eventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: null,
          stage: BugHuntEventStage.SETTINGS_CHANGED,
          payload: { mode: BugHunterMode.AI, updatedBy: 42 },
        }),
      );
    });
  });

  describe('appendEvent', () => {
    it('refuses to append to a run that already closed', async () => {
      currentRun = runRow({ status: BugHuntRunStatus.COMPLETED });

      await expect(
        service.appendEvent({
          runId: 'run-1',
          stage: BugHuntEventStage.FIX_ATTEMPT,
          summary: 'late report after close',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(eventRepository.save).not.toHaveBeenCalled();
    });

    it('raises an action-needed notification when the stage is escalated', async () => {
      await service.appendEvent({
        runId: 'run-1',
        stage: BugHuntEventStage.ESCALATED,
        summary: 'local tests still red after 2 attempts',
      });

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-1', repo: 'ally-be' }),
      );
    });

    it('does not notify Slack for a routine finder_result', async () => {
      await service.appendEvent({
        runId: 'run-1',
        stage: BugHuntEventStage.FINDER_RESULT,
        summary: 'lint violation in foo.ts:12',
      });

      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('closeRun', () => {
    const totals = {
      foundCount: 0,
      autoMergedCount: 0,
      prOpenedCount: 0,
      dismissedCount: 0,
    };

    it('stays quiet on a clean, empty, completed run', async () => {
      await service.closeRun('run-1', BugHuntRunStatus.COMPLETED, totals);

      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('always notifies for a failed run, even with zero findings', async () => {
      await service.closeRun(
        'run-1',
        BugHuntRunStatus.FAILED,
        totals,
        'lint runner crashed',
      );

      // A failed run is a PROBLEM, not INFO — the level is what decides
      // whether this reads as noise in the inbox.
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'problem',
          title: expect.stringMatching(/run failed/i),
        }),
      );
    });

    it('notifies when the run found at least one bug', async () => {
      await service.closeRun('run-1', BugHuntRunStatus.COMPLETED, {
        ...totals,
        foundCount: 2,
        prOpenedCount: 2,
      });

      expect(notificationService.notify).toHaveBeenCalled();
    });

    it('notifies when any event in the run escalated, even if the run itself completed', async () => {
      eventRepository.listForRun.mockResolvedValue([
        { stage: BugHuntEventStage.ESCALATED },
      ]);

      await service.closeRun('run-1', BugHuntRunStatus.COMPLETED, totals);

      expect(notificationService.notify).toHaveBeenCalled();
    });
  });
});
