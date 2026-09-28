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
import { BugHuntRunStatus } from '../../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';

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
