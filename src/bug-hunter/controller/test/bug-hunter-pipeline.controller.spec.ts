import { Test, TestingModule } from '@nestjs/testing';
import { BugHunterPipelineController } from '../bug-hunter-pipeline.controller';
import { BugHunterService } from '../../service/bug-hunter.service';
import { BugFindingService } from '../../service/bug-finding.service';
import { BugHunterFinderDataService } from '../../service/bug-hunter-finder-data.service';
import { BugFixSessionService } from '../../service/bug-fix-session.service';
import { AppConfigService } from 'src/config/config.service';
import { BugHunterModelSettingsService } from '../../service/bug-hunter-model-settings.service';
import { BugHunterTelemetryService } from '../../service/bug-hunter-telemetry.service';
import { BugHunterEvalService } from '../../service/bug-hunter-eval.service';
import { BugHunterPolicyService } from '../../service/bug-hunter-policy.service';
import { AgentMemoryService } from 'src/agent-memory/service/agent-memory.service';
import { SearchBugHunterMemoryQueryDto } from '../../dto/bug-hunter-memory.dto';
import { ValidationPipe } from '@nestjs/common';

describe('BugHunterPipelineController', () => {
  let controller: BugHunterPipelineController;
  let agentMemoryService: AgentMemoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BugHunterPipelineController],
      providers: [
        { provide: BugHunterService, useValue: {} },
        { provide: BugFindingService, useValue: {} },
        { provide: BugHunterFinderDataService, useValue: {} },
        { provide: BugFixSessionService, useValue: {} },
        { provide: AppConfigService, useValue: {} },
        { provide: BugHunterModelSettingsService, useValue: {} },
        {
          provide: BugHunterTelemetryService,
          useValue: { timed: jest.fn((_runId, _kind, fn) => fn()) },
        },
        { provide: BugHunterEvalService, useValue: {} },
        { provide: BugHunterPolicyService, useValue: {} },
        { provide: AgentMemoryService, useValue: { search: jest.fn() } },
      ],
    }).compile();

    controller = module.get<BugHunterPipelineController>(
      BugHunterPipelineController,
    );
    agentMemoryService = module.get<AgentMemoryService>(AgentMemoryService);
  });

  describe('searchMemory', () => {
    it('should handle `limit` as a string and convert it to a number', async () => {
      const query = {
        q: 'test',
        repo: 'ally-be',
        limit: '3',
      };

      const validationPipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      const dto = new SearchBugHunterMemoryQueryDto();
      dto.q = query.q;
      dto.repo = query.repo;
      dto.limit = Number(query.limit);

      await validationPipe.transform(dto, { type: 'query' });

      (agentMemoryService.search as jest.Mock).mockResolvedValue([]);

      await controller.searchMemory(dto);

      expect(agentMemoryService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 3,
        }),
      );
    });
  });
});
