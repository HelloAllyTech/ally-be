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
import { BugHunterDossierService } from '../../service/bug-hunter-dossier.service';
import { SearchBugHunterMemoryQueryDto } from '../../dto/bug-hunter-memory.dto';
import { AgentMemoryAgent } from 'src/agent-memory/enum/agent-memory.enum';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { ValidationPipe } from '@nestjs/common';

describe('BugHunterPipelineController', () => {
  let controller: BugHunterPipelineController;
  let agentMemoryService: AgentMemoryService;
  let bugFindingService: BugFindingService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [BugHunterPipelineController],
      providers: [
        { provide: BugHunterService, useValue: {} },
        { provide: BugFindingService, useValue: { setStatus: jest.fn() } },
        { provide: BugHunterFinderDataService, useValue: {} },
        {
          provide: BugFixSessionService,
          useValue: { deleteBranchAfterAgentMerge: jest.fn() },
        },
        { provide: AppConfigService, useValue: {} },
        { provide: BugHunterModelSettingsService, useValue: {} },
        {
          provide: BugHunterTelemetryService,
          useValue: { timed: jest.fn((_runId, _kind, fn) => fn()) },
        },
        { provide: BugHunterEvalService, useValue: {} },
        {
          provide: BugHunterPolicyService,
          useValue: { assertTransitionAllowed: jest.fn() },
        },
        {
          provide: AgentMemoryService,
          useValue: { search: jest.fn(), write: jest.fn() },
        },
        { provide: BugHunterDossierService, useValue: { build: jest.fn() } },
      ],
    }).compile();

    controller = module.get<BugHunterPipelineController>(
      BugHunterPipelineController,
    );
    agentMemoryService = module.get<AgentMemoryService>(AgentMemoryService);
    bugFindingService = module.get<BugFindingService>(BugFindingService);
  });

  describe('patchFinding when the agent reports its own merge', () => {
    const merged = {
      id: 'finding-2',
      repo: 'ally-ai-learn',
      prUrl: 'https://github.com/helloallytech/ally-ai-learn/pull/255',
      status: BugFindingStatus.MERGED,
      title: 't',
      description: 'd',
      metadata: {},
    };

    it('asks the session service to delete the branch as a backstop to --delete-branch (OPP-0750)', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(merged);
      const sessions = module.get<BugFixSessionService>(BugFixSessionService);

      await controller.patchFinding('finding-2', {
        status: BugFindingStatus.MERGED,
      });

      expect(sessions.deleteBranchAfterAgentMerge).toHaveBeenCalledWith(merged);
    });

    it('still returns the finding when the branch delete throws', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(merged);
      const sessions = module.get<BugFixSessionService>(BugFixSessionService);
      (sessions.deleteBranchAfterAgentMerge as jest.Mock).mockRejectedValue(
        new Error('GitHub down'),
      );

      const dto = await controller.patchFinding('finding-2', {
        status: BugFindingStatus.MERGED,
      });

      expect(dto.status).toBe(BugFindingStatus.MERGED);
    });

    it('does not touch GitHub for any other status', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue({
        ...merged,
        status: BugFindingStatus.PR_OPENED,
      });
      const sessions = module.get<BugFixSessionService>(BugFixSessionService);

      await controller.patchFinding('finding-2', {
        status: BugFindingStatus.PR_OPENED,
        prUrl: merged.prUrl,
      });

      expect(sessions.deleteBranchAfterAgentMerge).not.toHaveBeenCalled();
    });
  });

  describe('patchFinding with a post-mortem', () => {
    const failed = {
      id: 'finding-1',
      repo: 'ally-be',
      runId: 'run-1',
      status: BugFindingStatus.FAILED,
      title: 't',
      description: 'd',
      metadata: {},
    };

    it('writes a repo gotcha into the notebook as a candidate, tagged so the curator knows where it came from', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(failed);

      await controller.patchFinding('finding-1', {
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 2,
          failingCheck: 'full suite',
          lastFailure: 'x',
          rootCauseHypothesis: 'y',
          whyItFailed: 'z',
          tryNext: 'w',
          repoGotcha: '  scheduler specs need a live Redis on the runner ',
        },
      });

      expect(agentMemoryService.write).toHaveBeenCalledWith({
        agent: AgentMemoryAgent.BUG_HUNTER,
        body: 'ally-be: scheduler specs need a live Redis on the runner',
        repos: ['ally-be'],
        tags: ['fix-gotcha', 'postmortem'],
        runId: 'run-1',
        findingId: 'finding-1',
      });
    });

    it('writes nothing to the notebook when the post-mortem names no repo gotcha', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(failed);

      await controller.patchFinding('finding-1', {
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 1,
          failingCheck: 'regression test',
          lastFailure: 'x',
          rootCauseHypothesis: 'y',
          whyItFailed: 'z',
          tryNext: 'w',
        },
      });

      expect(agentMemoryService.write).not.toHaveBeenCalled();
    });

    it('still returns the finding when the notebook write fails — the failure was already recorded', async () => {
      (bugFindingService.setStatus as jest.Mock).mockResolvedValue(failed);
      (agentMemoryService.write as jest.Mock).mockRejectedValue(
        new Error('ally-ai down'),
      );

      const dto = await controller.patchFinding('finding-1', {
        status: BugFindingStatus.FAILED,
        postmortem: {
          attempts: 1,
          failingCheck: 'c',
          lastFailure: 'x',
          rootCauseHypothesis: 'y',
          whyItFailed: 'z',
          tryNext: 'w',
          repoGotcha: 'g',
        },
      });

      expect(dto.id).toBe('finding-1');
    });
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
