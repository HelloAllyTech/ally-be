import { BadRequestException, ConflictException } from '@nestjs/common';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { ImprovementOrchestratorService } from '../improvement-orchestrator.service';
import { RehearsalComparisonService } from '../rehearsal-comparison.service';
import { ImprovementHookService } from '../improvement-hook.service';
import { ImprovementNotificationService } from '../improvement-notification.service';
import { ImprovementRunRepository } from '../../repository/improvement-run.repository';
import { ImprovementRoundRepository } from '../../repository/improvement-round.repository';
import { CritiqueProposalRepository } from '../../repository/critique-proposal.repository';
import { RoleplaySpecService } from '../roleplay-spec.service';
import { SpecValidatorService } from '../spec-validator.service';
import { RehearsalService } from '../rehearsal.service';
import {
  ImprovementRoundKind,
  ImprovementRoundStatus,
  ImprovementRunOutcome,
  ImprovementRunStatus,
} from '../../enum/improvement-run.enum';
import { RehearsalStatus } from '../../enum/rehearsal-status.enum';
import { CritiqueProposalStatus } from '../../enum/critique-proposal-status.enum';
import { RoleplaySpecVersionSource } from '../../enum/roleplay-spec-version-source.enum';

const RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPEC_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BASE_VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEW_VERSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const REHEARSAL_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const USER_ID = 42;

const passingScores = {
  overall: 82,
  dimensions: {
    persona_consistency: 85,
    disclosure_discipline: 80,
    difficulty_calibration: 82,
    rubric_coverage: 80,
  },
  test_counts: { passed: 2, failed: 0, inconclusive: 0 },
  test_case_results: [
    { test_case_id: 'tc-1', title: 'A', verdict: 'PASSED' },
    { test_case_id: 'tc-2', title: 'B', verdict: 'PASSED' },
  ],
  test_pass_rate: 100,
};

const failingScores = {
  overall: 55,
  dimensions: {
    persona_consistency: 70,
    disclosure_discipline: 40,
    difficulty_calibration: 60,
    rubric_coverage: 50,
  },
  test_counts: { passed: 1, failed: 1, inconclusive: 0 },
  test_case_results: [
    { test_case_id: 'tc-1', title: 'A', verdict: 'PASSED' },
    { test_case_id: 'tc-2', title: 'B', verdict: 'FAILED' },
  ],
  test_pass_rate: 50,
};

describe('ImprovementOrchestratorService', () => {
  let service: ImprovementOrchestratorService;
  let runs: Map<string, Record<string, any>>;
  let rounds: Map<string, Record<string, any>>;
  let roundSeq: number;
  let mockRunRepo: Record<string, jest.Mock>;
  let mockRoundRepo: Record<string, jest.Mock>;
  let mockProposalRepo: Record<string, jest.Mock>;
  let mockSpecService: Record<string, jest.Mock>;
  let mockRehearsalService: Record<string, jest.Mock>;
  let mockRedis: Record<string, jest.Mock>;

  const makeRun = (overrides: Record<string, any> = {}) => {
    const run = {
      id: RUN_ID,
      specId: SPEC_ID,
      baseVersionId: BASE_VERSION_ID,
      status: ImprovementRunStatus.RUNNING,
      config: {
        maxRounds: 3,
        targets: { minOverall: 70, requireAllTestCasesPass: true },
        agentTestCaseIds: ['tc-1', 'tc-2'],
        traineeProfiles: ['SKILLED', 'POOR', 'ADVERSARIAL'],
        cheapIntermediateRounds: true,
        timeoutMinutes: 240,
      },
      currentRound: 1,
      metadata: null,
      createdBy: USER_ID,
      updatedBy: USER_ID,
      createdAt: new Date(Date.now() - 10 * 60_000),
      ...overrides,
    };
    runs.set(run.id, run);
    return run;
  };

  const makeRound = (overrides: Record<string, any> = {}) => {
    const round = {
      id: `round-${++roundSeq}`,
      improvementRunId: RUN_ID,
      roundNumber: roundSeq,
      kind: ImprovementRoundKind.BASELINE,
      candidateVersionId: BASE_VERSION_ID,
      rehearsalRunId: null,
      status: ImprovementRoundStatus.REHEARSING,
      fullScope: true,
      scores: null,
      deltas: null,
      proposalsAppliedCount: 0,
      ...overrides,
    };
    rounds.set(round.id, round);
    return round;
  };

  const rehearsalRun = (overrides: Record<string, any> = {}) => ({
    id: REHEARSAL_ID,
    specId: SPEC_ID,
    specVersionId: BASE_VERSION_ID,
    status: RehearsalStatus.COMPLETED,
    results: passingScores,
    improvementRoundId: [...rounds.values()][0]?.id ?? 'round-1',
    createdBy: USER_ID,
    ...overrides,
  });

  beforeEach(() => {
    runs = new Map();
    rounds = new Map();
    roundSeq = 0;

    mockRunRepo = {
      findActiveForSpec: jest.fn().mockResolvedValue(null),
      findAwaitingReview: jest.fn().mockResolvedValue(null),
      listBySpec: jest.fn(async () => [...runs.values()]),
      findOne: jest.fn(async ({ where }: any) => runs.get(where.id) ?? null),
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => {
        const saved = { id: RUN_ID, ...entity };
        runs.set(saved.id, saved);
        return saved;
      }),
      update: jest.fn(async (id: string, patch: Record<string, any>) => {
        Object.assign(runs.get(id) ?? {}, patch);
        return { affected: 1 };
      }),
    };
    mockRoundRepo = {
      findOne: jest.fn(async ({ where }: any) => {
        if (where.id) return rounds.get(where.id) ?? null;
        return null;
      }),
      findByRehearsalRunId: jest.fn(async (rehearsalRunId: string) =>
        [...rounds.values()].find((r) => r.rehearsalRunId === rehearsalRunId),
      ),
      listByRun: jest.fn(async () =>
        [...rounds.values()].sort((a, b) => a.roundNumber - b.roundNumber),
      ),
      create: jest.fn((entity) => entity),
      save: jest.fn(async (entity) => {
        const saved = { id: `round-${++roundSeq}`, ...entity };
        rounds.set(saved.id, saved);
        return saved;
      }),
      update: jest.fn(async (criteria: any, patch: Record<string, any>) => {
        const id = typeof criteria === 'string' ? criteria : criteria.id;
        const round = rounds.get(id);
        if (!round) return { affected: 0 };
        if (
          typeof criteria === 'object' &&
          criteria.status &&
          round.status !== criteria.status
        ) {
          return { affected: 0 };
        }
        Object.assign(round, patch);
        return { affected: 1 };
      }),
    };
    mockProposalRepo = {
      listByImprovementRun: jest.fn().mockResolvedValue([]),
      historyForSpec: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    mockSpecService = {
      getSpec: jest.fn().mockResolvedValue({
        id: SPEC_ID,
        updatedAt: new Date('2026-07-01T00:00:00Z'),
      }),
      getVersion: jest
        .fn()
        .mockResolvedValue({ id: BASE_VERSION_ID, spec: { title: 'Spec' } }),
      getVersionById: jest.fn(async (id: string) => ({
        id,
        spec: { title: 'Spec', openingStatement: 'Hi' },
      })),
      appendVersionSnapshot: jest
        .fn()
        .mockResolvedValue({ id: NEW_VERSION_ID }),
      persistDraftMutation: jest
        .fn()
        .mockResolvedValue({ version: { id: 'draft-version-id' } }),
    };
    mockRehearsalService = {
      createRehearsal: jest.fn(async (_s, _v, _dto, _u, options) =>
        rehearsalRun({
          status: RehearsalStatus.STARTED,
          improvementRoundId: options?.improvementRoundId,
        }),
      ),
      getRehearsal: jest.fn(async () => rehearsalRun()),
      cancelRehearsal: jest.fn().mockResolvedValue({ success: true }),
      critiqueRehearsal: jest.fn().mockResolvedValue({ proposals: [] }),
    };
    mockRedis = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    service = new ImprovementOrchestratorService(
      mockRunRepo as unknown as ImprovementRunRepository,
      mockRoundRepo as unknown as ImprovementRoundRepository,
      mockProposalRepo as unknown as CritiqueProposalRepository,
      mockSpecService as unknown as RoleplaySpecService,
      {
        validate: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
        validateStructure: jest.fn().mockReturnValue([]),
      } as unknown as SpecValidatorService,
      mockRehearsalService as unknown as RehearsalService,
      new RehearsalComparisonService(),
      new ImprovementHookService(),
      new ImprovementNotificationService(),
      mockRedis as unknown as RedisService,
      {
        roleplayStudio: { rehearsalTimeoutMinutes: 30 },
      } as unknown as AppConfigService,
    );
  });

  // ------------------------------------------------------------------- start

  it('startImprovementRun creates the run + BASELINE round and dispatches a rehearsal', async () => {
    await service.startImprovementRun(
      SPEC_ID,
      BASE_VERSION_ID,
      { agentTestCaseIds: ['tc-1', 'tc-2'] },
      USER_ID,
    );

    const round = [...rounds.values()][0];
    expect(round.kind).toBe(ImprovementRoundKind.BASELINE);
    expect(mockRehearsalService.createRehearsal).toHaveBeenCalledWith(
      SPEC_ID,
      BASE_VERSION_ID,
      expect.objectContaining({ agentTestCaseIds: ['tc-1', 'tc-2'] }),
      USER_ID,
      { improvementRoundId: round.id },
    );
    expect(mockRedis.set).toHaveBeenCalledWith(
      `roleplay-improvement:${RUN_ID}`,
      RUN_ID,
      expect.any(Number),
    );
  });

  it('rejects a second run while one is RUNNING', async () => {
    mockRunRepo.findActiveForSpec.mockResolvedValue(makeRun());
    await expect(
      service.startImprovementRun(SPEC_ID, BASE_VERSION_ID, {}, USER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  // ------------------------------------------------------ onRehearsalFinished

  it('finishes with TARGETS_MET when a full-scope round meets the targets', async () => {
    const run = makeRun();
    const round = makeRound();

    await service.onRehearsalFinished(
      rehearsalRun({ improvementRoundId: round.id }) as any,
    );

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.AWAITING_REVIEW);
    expect(runs.get(run.id)!.outcome).toBe(ImprovementRunOutcome.TARGETS_MET);
    expect(runs.get(run.id)!.bestVersionId).toBe(BASE_VERSION_ID);
    expect(mockRedis.del).toHaveBeenCalledWith(
      `roleplay-improvement:${RUN_ID}`,
    );
  });

  it('critiques + applies proposals and spawns the next (cheap) round when targets miss', async () => {
    makeRun();
    const round = makeRound();
    mockRehearsalService.critiqueRehearsal.mockResolvedValue({
      proposals: [
        {
          id: 'prop-1',
          ops: [{ op: 'replace', path: '/openingStatement', value: 'better' }],
          summary: 'fix opening',
        },
      ],
    });

    await service.onRehearsalFinished(
      rehearsalRun({
        improvementRoundId: round.id,
        results: failingScores,
      }) as any,
    );

    expect(mockSpecService.appendVersionSnapshot).toHaveBeenCalledWith(
      SPEC_ID,
      expect.objectContaining({ openingStatement: 'better' }),
      USER_ID,
      RoleplaySpecVersionSource.AUTO_IMPROVE,
    );
    expect(mockProposalRepo.update).toHaveBeenCalledWith(['prop-1'], {
      status: CritiqueProposalStatus.APPLIED,
      appliedInVersionId: NEW_VERSION_ID,
    });
    const nextRound = [...rounds.values()].find(
      (r) => r.kind === ImprovementRoundKind.ITERATION,
    );
    expect(nextRound).toBeDefined();
    expect(nextRound!.candidateVersionId).toBe(NEW_VERSION_ID);
    // Cheap narrowing: only the failing test case is re-run, no profiles met
    // the failing screen in per_profile (absent) → cases only.
    const dispatchCalls = mockRehearsalService.createRehearsal.mock.calls;
    const dispatchDto = dispatchCalls[dispatchCalls.length - 1][2];
    expect(dispatchDto.agentTestCaseIds).toEqual(['tc-2']);
  });

  it('finishes NO_PROPOSALS when the critic returns nothing', async () => {
    const run = makeRun();
    const round = makeRound();
    mockRehearsalService.critiqueRehearsal.mockResolvedValue({
      proposals: [],
    });

    await service.onRehearsalFinished(
      rehearsalRun({
        improvementRoundId: round.id,
        results: failingScores,
      }) as any,
    );

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.AWAITING_REVIEW);
    expect(runs.get(run.id)!.outcome).toBe(ImprovementRunOutcome.NO_PROPOSALS);
  });

  it('spawns FINAL_VERIFICATION when a cheap round meets targets', async () => {
    makeRun();
    const round = makeRound({
      kind: ImprovementRoundKind.ITERATION,
      roundNumber: 2,
      fullScope: false,
      candidateVersionId: NEW_VERSION_ID,
    });

    await service.onRehearsalFinished(
      rehearsalRun({ improvementRoundId: round.id }) as any,
    );

    const finalRound = [...rounds.values()].find(
      (r) => r.kind === ImprovementRoundKind.FINAL_VERIFICATION,
    );
    expect(finalRound).toBeDefined();
    expect(finalRound!.candidateVersionId).toBe(NEW_VERSION_ID);
  });

  it('fails the run when the rehearsal ended FAILED', async () => {
    const run = makeRun();
    const round = makeRound();

    await service.onRehearsalFinished(
      rehearsalRun({
        improvementRoundId: round.id,
        status: RehearsalStatus.FAILED,
      }) as any,
    );

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.FAILED);
    expect(runs.get(run.id)!.outcome).toBe(
      ImprovementRunOutcome.REHEARSAL_FAILED,
    );
  });

  it('is idempotent: a re-delivered webhook for a processed round is a no-op', async () => {
    makeRun();
    const round = makeRound({ status: ImprovementRoundStatus.DONE });

    await service.onRehearsalFinished(
      rehearsalRun({ improvementRoundId: round.id }) as any,
    );

    expect(mockRehearsalService.critiqueRehearsal).not.toHaveBeenCalled();
    expect(mockSpecService.appendVersionSnapshot).not.toHaveBeenCalled();
  });

  it('picks the BEST full-scope round (tests first), not the last', async () => {
    const run = makeRun({ config: { ...makeRun().config, maxRounds: 2 } });
    runs.set(run.id, run);
    makeRound({
      status: ImprovementRoundStatus.DONE,
      scores: passingScores,
      candidateVersionId: 'good-version',
      roundNumber: 1,
    });
    const lastRound = makeRound({
      kind: ImprovementRoundKind.ITERATION,
      roundNumber: 2,
      candidateVersionId: 'worse-version',
    });

    await service.onRehearsalFinished(
      rehearsalRun({
        improvementRoundId: lastRound.id,
        results: failingScores,
      }) as any,
    );

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.AWAITING_REVIEW);
    expect(runs.get(run.id)!.bestVersionId).toBe('good-version');
  });

  it('verifies the previous round’s proposals against expectedEffect', async () => {
    makeRun();
    makeRound({
      status: ImprovementRoundStatus.DONE,
      scores: failingScores,
      roundNumber: 1,
    });
    const round2 = makeRound({
      kind: ImprovementRoundKind.ITERATION,
      roundNumber: 2,
      candidateVersionId: NEW_VERSION_ID,
    });
    mockProposalRepo.listByImprovementRun.mockResolvedValue([
      {
        id: 'prop-ok',
        roundNumber: 1,
        status: CritiqueProposalStatus.APPLIED,
        ops: [{ op: 'replace', path: '/a', value: 1 }],
        expectedEffect: {
          dimensions: [
            { name: 'disclosure_discipline', direction: 'increase' },
          ],
          testCases: [{ id: 'tc-2', expectedVerdict: 'PASSED' }],
        },
      },
    ]);

    await service.onRehearsalFinished(
      rehearsalRun({ improvementRoundId: round2.id }) as any,
    );

    expect(mockProposalRepo.update).toHaveBeenCalledWith(
      'prop-ok',
      expect.objectContaining({ status: CritiqueProposalStatus.VERIFIED }),
    );
  });

  // ------------------------------------------------------------------ review

  it('acceptRun copies the best version into the draft with AUTO_IMPROVE_ACCEPTED', async () => {
    const run = makeRun({
      status: ImprovementRunStatus.AWAITING_REVIEW,
      bestVersionId: NEW_VERSION_ID,
    });

    await service.acceptRun(run.id, {}, USER_ID);

    expect(mockSpecService.persistDraftMutation).toHaveBeenCalledWith(
      expect.objectContaining({ id: SPEC_ID }),
      expect.objectContaining({ title: 'Spec' }),
      USER_ID,
      RoleplaySpecVersionSource.AUTO_IMPROVE_ACCEPTED,
    );
    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.ACCEPTED);
    expect(runs.get(run.id)!.acceptedVersionId).toBe('draft-version-id');
  });

  it('acceptRun 409s on a stale draft concurrency token', async () => {
    const run = makeRun({
      status: ImprovementRunStatus.AWAITING_REVIEW,
      bestVersionId: NEW_VERSION_ID,
    });

    await expect(
      service.acceptRun(
        run.id,
        { expectedDraftUpdatedAt: '2020-01-01T00:00:00Z' },
        USER_ID,
      ),
    ).rejects.toThrow(ConflictException);
    expect(mockSpecService.persistDraftMutation).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------- watchdog

  it('handleExpiredImprovement finishes best-so-far when a round scored', async () => {
    const run = makeRun({
      createdAt: new Date(Date.now() - 500 * 60_000),
    });
    makeRound({ status: ImprovementRoundStatus.DONE, scores: passingScores });

    await service.handleExpiredImprovement(run.id);

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.AWAITING_REVIEW);
    expect(runs.get(run.id)!.outcome).toBe(ImprovementRunOutcome.TIMED_OUT);
  });

  it('handleExpiredImprovement fails a run with no scored rounds', async () => {
    const run = makeRun({
      createdAt: new Date(Date.now() - 500 * 60_000),
    });
    makeRound();

    await service.handleExpiredImprovement(run.id);

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.FAILED);
  });

  // ------------------------------------------------------------------ cancel

  it('cancelRun flips the run first, then cancels the in-flight rehearsal', async () => {
    const run = makeRun();
    makeRound({ rehearsalRunId: REHEARSAL_ID });

    await service.cancelRun(run.id, USER_ID);

    expect(runs.get(run.id)!.status).toBe(ImprovementRunStatus.CANCELLED);
    expect(mockRehearsalService.cancelRehearsal).toHaveBeenCalledWith(
      REHEARSAL_ID,
      USER_ID,
    );
  });
});
