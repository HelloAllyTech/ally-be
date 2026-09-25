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
        stage: BugHuntEventStage.INFO,
        summary: 'This is a test event.',
      };

      await expect(service.appendEvent(eventParams)).resolves.not.toThrow();

      expect(eventRepository.save).toHaveBeenCalled();
    });
  });
});
