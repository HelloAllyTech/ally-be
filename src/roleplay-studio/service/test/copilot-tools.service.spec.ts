import { DataSource } from 'typeorm';
import {
  CopilotToolsService,
  ToolExecutionContext,
} from '../copilot-tools.service';
import { RoleplaySpecService } from '../roleplay-spec.service';
import { SpecValidatorService } from '../spec-validator.service';
import { SpecCompilerService } from '../spec-compiler.service';
import { CritiqueEvidenceService } from '../critique-evidence.service';
import { RehearsalComparisonService } from '../rehearsal-comparison.service';
import { ImprovementOrchestratorService } from '../improvement-orchestrator.service';
import { RehearsalRunRepository } from '../../repository/rehearsal-run.repository';
import { RehearsalTranscriptRepository } from '../../repository/rehearsal-transcript.repository';
import { CritiqueProposalRepository } from '../../repository/critique-proposal.repository';
import { ImprovementRunRepository } from '../../repository/improvement-run.repository';
import { ImprovementRoundRepository } from '../../repository/improvement-round.repository';
import { RoleplaySpec } from '../../entity/roleplay-spec.entity';
import { RoleplaySpecVersionSource } from '../../enum/roleplay-spec-version-source.enum';

const SPEC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RUN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_ID = 42;

describe('CopilotToolsService — auto-improve tools', () => {
  let service: CopilotToolsService;
  let context: ToolExecutionContext;
  let mockSpecService: Record<string, jest.Mock>;
  let mockValidator: Record<string, jest.Mock>;
  let mockOrchestrator: Record<string, jest.Mock>;
  let mockImprovementRunRepo: Record<string, jest.Mock>;

  const spec = {
    id: SPEC_ID,
    draftSpec: { title: 'Spec', agentTestCaseIds: ['tc-1', 'tc-2'] },
  } as unknown as RoleplaySpec;

  beforeEach(() => {
    mockSpecService = {
      persistDraftMutation: jest.fn().mockResolvedValue({
        spec,
        version: { id: VERSION_ID },
      }),
      getSpec: jest.fn().mockResolvedValue(spec),
      getVersionById: jest.fn(),
    };
    mockValidator = {
      validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
      validateStructure: jest.fn().mockReturnValue([]),
    };
    mockOrchestrator = {
      startImprovementRun: jest.fn().mockResolvedValue({
        id: RUN_ID,
        config: { maxRounds: 3, targets: { minOverall: 70 } },
      }),
      acceptRun: jest.fn().mockResolvedValue({
        id: RUN_ID,
        status: 'ACCEPTED',
        bestVersionId: 'v-best',
        acceptedVersionId: 'v-accepted',
      }),
      discardRun: jest.fn().mockResolvedValue({
        id: RUN_ID,
        status: 'DISCARDED',
        bestVersionId: 'v-best',
        acceptedVersionId: null,
      }),
    };
    mockImprovementRunRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      findAwaitingReview: jest
        .fn()
        .mockResolvedValue({ id: RUN_ID, specId: SPEC_ID }),
      listBySpec: jest.fn().mockResolvedValue([]),
    };

    service = new CopilotToolsService(
      mockSpecService as unknown as RoleplaySpecService,
      mockValidator as unknown as SpecValidatorService,
      { compileWithInfo: jest.fn() } as unknown as SpecCompilerService,
      { buildEvidence: jest.fn() } as unknown as CritiqueEvidenceService,
      { compare: jest.fn() } as unknown as RehearsalComparisonService,
      {} as unknown as RehearsalRunRepository,
      {} as unknown as RehearsalTranscriptRepository,
      {} as unknown as CritiqueProposalRepository,
      mockImprovementRunRepo as unknown as ImprovementRunRepository,
      {} as unknown as ImprovementRoundRepository,
      mockOrchestrator as unknown as ImprovementOrchestratorService,
      {
        getRepository: jest.fn(() => ({
          find: jest
            .fn()
            .mockResolvedValue([
              { id: 'tc-1', title: 'Case', category: 'safety' },
            ]),
        })),
      } as unknown as DataSource,
    );

    context = {
      spec,
      sessionId: SESSION_ID,
      userId: USER_ID,
      appliedPatches: [],
      lastSpecVersionId: null,
    };
  });

  it('propose_rehearsal is gone; the new tools are defined', () => {
    const names = service.getToolDefinitions().map((tool: any) => tool.name);
    expect(names).not.toContain('propose_rehearsal');
    expect(names).toEqual(
      expect.arrayContaining([
        'start_auto_improve',
        'resolve_improvement_run',
        'get_agent_test_cases',
      ]),
    );
  });

  describe('start_auto_improve', () => {
    it('snapshots the draft and starts a copilot-linked auto-accepting run', async () => {
      const outcome = await service.execute(
        'start_auto_improve',
        { maxRounds: 2, minOverall: 80 },
        context,
      );

      expect(mockSpecService.persistDraftMutation).toHaveBeenCalledWith(
        spec,
        spec.draftSpec,
        USER_ID,
        RoleplaySpecVersionSource.SNAPSHOT,
      );
      expect(mockOrchestrator.startImprovementRun).toHaveBeenCalledWith(
        SPEC_ID,
        VERSION_ID,
        expect.objectContaining({
          maxRounds: 2,
          targets: expect.objectContaining({ minOverall: 80 }),
          agentTestCaseIds: ['tc-1', 'tc-2'],
        }),
        USER_ID,
        { copilotSessionId: SESSION_ID, autoAcceptOnTargetsMet: true },
      );
      expect(outcome.modelResult).toEqual(
        expect.objectContaining({ ok: true, improvementRunId: RUN_ID }),
      );
      expect(context.lastSpecVersionId).toBe(VERSION_ID);
    });

    it('refuses an invalid draft with the error list (self-repair path)', async () => {
      mockValidator.validate.mockResolvedValue({
        valid: false,
        errors: [{ path: '/rubric', code: 'required', message: 'missing' }],
      });

      const outcome = await service.execute('start_auto_improve', {}, context);

      expect(outcome.modelResult.ok).toBe(false);
      expect(outcome.modelResult.error).toBe('spec_invalid');
      expect(mockOrchestrator.startImprovementRun).not.toHaveBeenCalled();
    });

    it('maps the already-in-progress error to run_in_progress', async () => {
      mockOrchestrator.startImprovementRun.mockRejectedValue(
        new Error('An improvement run is already in progress for this spec'),
      );

      const outcome = await service.execute('start_auto_improve', {}, context);

      expect(outcome.modelResult).toEqual(
        expect.objectContaining({ ok: false, error: 'run_in_progress' }),
      );
    });
  });

  describe('resolve_improvement_run', () => {
    it('accepts the latest awaiting-review run and refreshes the context spec', async () => {
      const outcome = await service.execute(
        'resolve_improvement_run',
        { action: 'accept' },
        context,
      );

      expect(mockImprovementRunRepo.findAwaitingReview).toHaveBeenCalledWith(
        SPEC_ID,
      );
      expect(mockOrchestrator.acceptRun).toHaveBeenCalledWith(
        RUN_ID,
        {},
        USER_ID,
      );
      expect(mockSpecService.getSpec).toHaveBeenCalledWith(SPEC_ID);
      expect(outcome.modelResult).toEqual(
        expect.objectContaining({ ok: true, status: 'ACCEPTED' }),
      );
    });

    it('discards without touching the context spec', async () => {
      const outcome = await service.execute(
        'resolve_improvement_run',
        { action: 'discard' },
        context,
      );
      expect(mockOrchestrator.discardRun).toHaveBeenCalledWith(RUN_ID, USER_ID);
      expect(mockSpecService.getSpec).not.toHaveBeenCalled();
      expect(outcome.modelResult.status).toBe('DISCARDED');
    });

    it('reports when nothing awaits review', async () => {
      mockImprovementRunRepo.findAwaitingReview.mockResolvedValue(null);
      const outcome = await service.execute(
        'resolve_improvement_run',
        { action: 'accept' },
        context,
      );
      expect(outcome.modelResult).toEqual(
        expect.objectContaining({ ok: false, error: 'no_run_awaiting_review' }),
      );
    });
  });

  it('get_agent_test_cases lists the catalog', async () => {
    const outcome = await service.execute('get_agent_test_cases', {}, context);
    expect(outcome.modelResult.ok).toBe(true);
    expect(outcome.modelResult.testCases).toEqual([
      expect.objectContaining({ id: 'tc-1', title: 'Case' }),
    ]);
  });
});
