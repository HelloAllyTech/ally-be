import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BugHunterService } from '../bug-hunter.service';
import { BugHunterSettingsRepository } from '../../repository/bug-hunter-settings.repository';
import { BugHuntRunRepository } from '../../repository/bug-hunt-run.repository';
import { BugHuntEventRepository } from '../../repository/bug-hunt-event.repository';
import { BugHunterNotificationService } from '../bug-hunter-notification.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { BugHunterFinderDataService } from '../bug-hunter-finder-data.service';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';
import { BugCaseBudgetService } from '../bug-case-budget.service';

describe('BugHunterService', () => {
  let service: BugHunterService;
  let eventRepository: BugHuntEventRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BugHunterService,
        { provide: BugHunterSettingsRepository, useValue: {} },
        {
          provide: BugHuntRunRepository,
          useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: BugHuntEventRepository,
          useValue: { save: jest.fn(), create: jest.fn() },
        },
        { provide: BugHunterNotificationService, useValue: {} },
        { provide: DataSource, useValue: {} },
        { provide: LlmUsageService, useValue: {} },
        { provide: GithubActionsService, useValue: {} },
        { provide: BugHunterFinderDataService, useValue: {} },
        {
          provide: BugCaseBudgetService,
          useValue: { charge: jest.fn(), chargeRun: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<BugHunterService>(BugHunterService);
    eventRepository = module.get<BugHuntEventRepository>(
      BugHuntEventRepository,
    );
  });

  describe('recordActualCost', () => {
    it('labels each usage row by its model, not by the run engine', async () => {
      // A Claude-engine run that spawned Gemini subagents (and a Gemini-engine
      // run reporting Claude models) used to file every row under the engine.
      const record = jest.fn().mockResolvedValue(undefined);
      (service as any).llmUsageService = { record };
      (service as any).runRepository = { update: jest.fn() };
      jest
        .spyOn(service, 'getRun')
        .mockResolvedValue({ id: 'run-1', engine: 'claude' } as BugHuntRun);
      jest.spyOn(service as any, 'snapshotUsage').mockResolvedValue({
        costUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      });

      await service.recordActualCost('run-1', {
        modelUsage: [
          { model: 'claude-opus-5', inputTokens: 10, outputTokens: 1 },
          { model: 'gemini-2.5-flash', inputTokens: 10, outputTokens: 1 },
          { model: 'mystery-model', inputTokens: 10, outputTokens: 1 },
        ],
      });

      const byModel = Object.fromEntries(
        record.mock.calls.map(([row]) => [row.model, row.provider]),
      );
      expect(byModel).toEqual({
        'claude-opus-5': 'anthropic',
        'gemini-2.5-flash': 'gemini',
        // No provider in the id: fall back to the engine that ran.
        'mystery-model': 'anthropic',
      });
    });
  });

  describe('appendEvent', () => {
    it('should not throw a ForbiddenException when appending an event to a completed run', async () => {
      const runId = 'a-completed-run-id';
      const completedRun = {
        id: runId,
        status: BugHuntRunStatus.COMPLETED,
      } as BugHuntRun;

      jest.spyOn(service, 'getRun').mockResolvedValue(completedRun);

      const eventParams = {
        runId,
        stage: BugHuntEventStage.SESSION_DISPATCHED,
        summary: 'This is a test event.',
      };

      await expect(service.appendEvent(eventParams)).resolves.not.toThrow();

      expect(eventRepository.save).toHaveBeenCalled();
    });
  });
});

describe('BugHunterService.reconcileStaleRuns', () => {
  const now = new Date('2026-09-29T06:00:00.000Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const run = (over: Partial<BugHuntRun>): BugHuntRun =>
    ({
      id: 'run-1',
      repo: 'ally-be',
      trigger: BugHuntTrigger.SCHEDULED,
      status: BugHuntRunStatus.RUNNING,
      metadata: null,
      createdAt: minutesAgo(300),
      ...over,
    }) as BugHuntRun;

  const build = (running: BugHuntRun[]) => {
    const runRepository = {
      listRunning: jest.fn().mockResolvedValue(running),
      findOne: jest.fn(
        async ({ where }: any) =>
          running.find((r) => r.id === where.id) ?? null,
      ),
      update: jest.fn(),
    };
    const eventRepository = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn(async (row: unknown) => row),
      listForRun: jest.fn().mockResolvedValue([]),
    };
    const notificationService = { notify: jest.fn() };
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ count: '3' }]),
      createQueryBuilder: jest.fn(() => {
        throw new Error('no usage table in this test');
      }),
    };
    const service = new BugHunterService(
      {} as never,
      runRepository as never,
      eventRepository as never,
      notificationService as never,
      dataSource as never,
      {} as never,
      {} as never,
      {} as never,
      { charge: jest.fn(), chargeRun: jest.fn() } as never, // budget (OPP-0775)
    );
    return { service, runRepository, eventRepository, notificationService };
  };

  it('closes a sweep that is past its budget plus grace as failed, with an error event and what it filed', async () => {
    const { service, runRepository, eventRepository } = build([
      run({ createdAt: minutesAgo(120 + 15 + 1) }),
    ]);

    const closed = await service.reconcileStaleRuns(now);

    expect(closed).toBe(1);
    expect(eventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        stage: BugHuntEventStage.ERROR,
        summary: expect.stringContaining('stopped reporting'),
        payload: expect.objectContaining({
          reconciled: true,
          budgetMinutes: 120,
        }),
      }),
    );
    expect(runRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: BugHuntRunStatus.FAILED,
        foundCount: 3,
        finishedAt: expect.any(Date),
      }),
    );
  });

  it('leaves a run alone while it is still inside its budget', async () => {
    const { service, runRepository } = build([
      run({ createdAt: minutesAgo(90) }),
    ]);
    expect(await service.reconcileStaleRuns(now)).toBe(0);
    expect(runRepository.update).not.toHaveBeenCalled();
  });

  it('gives a fix session its own, shorter budget', async () => {
    const { service, runRepository } = build([
      run({
        id: 'fix-1',
        trigger: BugHuntTrigger.FIX_SESSION,
        createdAt: minutesAgo(60 + 15 + 1),
      }),
      run({
        id: 'fix-2',
        trigger: BugHuntTrigger.FIX_SESSION,
        createdAt: minutesAgo(70),
      }),
    ]);
    expect(await service.reconcileStaleRuns(now)).toBe(1);
    expect(runRepository.update).toHaveBeenCalledWith(
      'fix-1',
      expect.objectContaining({ status: BugHuntRunStatus.FAILED }),
    );
    expect(runRepository.update).not.toHaveBeenCalledWith(
      'fix-2',
      expect.anything(),
    );
  });
});
