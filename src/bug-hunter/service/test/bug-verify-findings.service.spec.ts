import { ForbiddenException } from '@nestjs/common';

import { BugVerifyFindingsService } from '../bug-verify-findings.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    runId: 'sweep-1',
    source: BugFindingSource.CODE_REVIEW,
    status: BugFindingStatus.NEW,
    proven: false,
    title: 'Settings buttons stay in English',
    metadata: { confidence: 0.9 },
    ...overrides,
  }) as BugFinding;

describe('BugVerifyFindingsService', () => {
  let rows: BugFinding[];
  let findingRepository: { find: jest.Mock; update: jest.Mock };
  let bugFindingService: { getOne: jest.Mock; setStatus: jest.Mock };
  let bugHunterService: {
    getRun: jest.Mock;
    startRun: jest.Mock;
    setRunMetadata: jest.Mock;
    closeRun: jest.Mock;
    appendEvent: jest.Mock;
    appendFindingEvent: jest.Mock;
    getSettings: jest.Mock;
  };
  let github: { dispatchWorkflow: jest.Mock };
  let policy: { assertMayFix: jest.Mock };
  let fixSession: { startByAgent: jest.Mock };
  let orchestrator: {
    recordVerifierChoice: jest.Mock;
    onFindingConfirmed: jest.Mock;
  };
  let service: BugVerifyFindingsService;

  const sweep = {
    id: 'sweep-1',
    repo: 'ally-web',
    trigger: BugHuntTrigger.SCHEDULED,
    engine: 'gemini',
    model: 'gemini-2.5-pro',
    metadata: {},
  };
  const verifyRun = {
    id: 'verify-1',
    repo: 'ally-web',
    trigger: BugHuntTrigger.VERIFY_FINDINGS,
    engine: 'gemini',
    model: 'gemini-2.5-pro',
    metadata: {
      verifyFindings: {
        counterpart: { engine: 'gemini', model: 'gemini-2.5-pro' },
      },
    },
  };

  beforeEach(() => {
    rows = [
      finding(),
      finding({ id: 'f-2', proven: true }),
      finding({ id: 'f-3', source: BugFindingSource.REPORTED_BUG }),
    ];
    findingRepository = {
      find: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            rows.filter(
              (r) =>
                r.runId === where.runId &&
                r.status === where.status &&
                r.proven === where.proven,
            ),
          ),
        ),
      update: jest.fn().mockImplementation((id, patch) => {
        rows = rows.map((r) =>
          r.id === id ? ({ ...r, ...patch } as BugFinding) : r,
        );
        return Promise.resolve();
      }),
    };
    bugFindingService = {
      getOne: jest
        .fn()
        .mockImplementation((id) =>
          Promise.resolve(rows.find((r) => r.id === id)),
        ),
      setStatus: jest.fn().mockImplementation((id, patch) => {
        rows = rows.map((r) =>
          r.id === id ? ({ ...r, ...patch } as BugFinding) : r,
        );
        return Promise.resolve(rows.find((r) => r.id === id));
      }),
    };
    bugHunterService = {
      getRun: jest
        .fn()
        .mockImplementation((id) =>
          Promise.resolve(id === 'sweep-1' ? sweep : verifyRun),
        ),
      startRun: jest.fn().mockResolvedValue({ id: 'verify-1' }),
      setRunMetadata: jest.fn(),
      closeRun: jest.fn(),
      appendEvent: jest.fn(),
      appendFindingEvent: jest.fn(),
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.AI }),
    };
    github = { dispatchWorkflow: jest.fn().mockResolvedValue(new Date()) };
    policy = { assertMayFix: jest.fn().mockResolvedValue(undefined) };
    fixSession = { startByAgent: jest.fn().mockResolvedValue(undefined) };
    orchestrator = {
      recordVerifierChoice: jest.fn().mockResolvedValue(undefined),
      onFindingConfirmed: jest.fn().mockResolvedValue('fix'),
    };
    service = new BugVerifyFindingsService(
      findingRepository as never,
      bugFindingService as never,
      bugHunterService as never,
      github as never,
      policy as never,
      fixSession as never,
      {
        get: jest.fn().mockResolvedValue({
          engine: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          escalationModel: 'gemini-2.5-pro',
        }),
      } as never,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
      orchestrator as never,
    );
  });

  describe('dispatchForRun', () => {
    it('sends only the unproven, non-human findings of a closed sweep to one Gemini verifier run, marking them pending', async () => {
      const d = await service.dispatchForRun('sweep-1');

      expect(d?.findingIds).toEqual(['f-1']);
      expect(d?.counterpart).toEqual({
        engine: 'gemini',
        model: 'gemini-2.5-pro',
      });
      expect(bugHunterService.startRun).toHaveBeenCalledWith(
        BugHuntTrigger.VERIFY_FINDINGS,
        'ally-web',
      );
      expect(bugHunterService.setRunMetadata).toHaveBeenCalledWith('verify-1', {
        verifyFindings: expect.objectContaining({ sweepRunId: 'sweep-1' }),
      });
      expect(rows.find((r) => r.id === 'f-1')?.metadata).toMatchObject({
        independentVerification: 'pending',
        verifyFindingsRunId: 'verify-1',
      });
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            mode: 'verify_findings',
            finding_id: 'verify-1',
            run_id: 'verify-1',
          }),
        }),
      );
      expect(bugHunterService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.VERIFY,
          runId: 'verify-1',
        }),
      );
    });

    it('does nothing for a fix-session run or a sweep that kept nothing unproven', async () => {
      bugHunterService.getRun.mockResolvedValueOnce({
        ...sweep,
        trigger: BugHuntTrigger.FIX_SESSION,
      });
      expect(await service.dispatchForRun('sweep-1')).toBeNull();
      rows = [finding({ proven: true })];
      expect(await service.dispatchForRun('sweep-1')).toBeNull();
      expect(bugHunterService.startRun).not.toHaveBeenCalled();
    });

    it('unmarks the findings and closes the run when GitHub refuses the dispatch', async () => {
      github.dispatchWorkflow.mockRejectedValue(new Error('422'));
      expect(await service.dispatchForRun('sweep-1')).toBeNull();
      expect(bugHunterService.closeRun).toHaveBeenCalledWith(
        'verify-1',
        'failed',
        expect.anything(),
        '422',
      );
      expect(
        rows.find((r) => r.id === 'f-1')?.metadata?.independentVerification,
      ).toBeNull();
    });
  });

  describe('recordVerdict', () => {
    beforeEach(() => {
      rows = [
        finding({
          metadata: {
            confidence: 0.9,
            independentVerification: 'pending',
            verifyFindingsRunId: 'verify-1',
          },
        }),
      ];
    });

    it('confirms, lowers confidence to the stricter reader, and hands D5 to the orchestrator', async () => {
      const v = await service.recordVerdict('f-1', {
        verdict: 'confirmed',
        confidence: 0.8,
        reproduction: 'failing test: 12 keys missing',
        refutation: 'no guard upstream',
      });

      expect(v?.verdict).toBe('confirmed');
      expect(v?.by).toEqual({
        engine: 'gemini',
        model: 'gemini-2.5-pro',
      });
      const row = rows[0];
      expect(row.metadata).toMatchObject({
        independentVerification: 'confirmed',
        confidence: 0.8,
      });
      expect(row.metadata?.findingVerdicts).toHaveLength(1);
      // D5 (OPP-0783): the orchestrator decides fix-now or hold, with the
      // lowered confidence in hand; the mode and confidence vetoes live there.
      expect(orchestrator.onFindingConfirmed).toHaveBeenCalledWith('f-1', 0.8);
      expect(fixSession.startByAgent).not.toHaveBeenCalled();
    });

    it('records D4 when it dispatches the Verifier (OPP-0783)', async () => {
      rows = [finding({ id: 'f-1' })];
      await service.dispatchForRun('sweep-1');
      expect(orchestrator.recordVerifierChoice).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'finding',
          runId: 'verify-1',
          findingId: null,
          counterpart: { engine: 'gemini', model: 'gemini-2.5-pro' },
        }),
      );
    });

    it('dismisses a refuted finding with the refutation as the reason, by verification', async () => {
      await service.recordVerdict('f-1', {
        verdict: 'refuted',
        confidence: 0.85,
        refutation: 'a guard upstream rejects that input',
      });

      expect(bugFindingService.setStatus).toHaveBeenCalledWith('f-1', {
        status: BugFindingStatus.DISMISSED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        decisionNote: 'a guard upstream rejects that input',
        confidence: 0.85,
      });
      expect(bugHunterService.appendFindingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.DECISION_RECORDED,
          summary: expect.stringContaining('independent verifier'),
        }),
      );
      expect(fixSession.startByAgent).not.toHaveBeenCalled();
    });

    it('holds an unsure finding for a person', async () => {
      await service.recordVerdict('f-1', {
        verdict: 'unsure',
        wouldBeWrongIf: 'the route is never reached',
      });
      expect(bugFindingService.setStatus).toHaveBeenCalledWith('f-1', {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
    });

    it('leaves a finding a person already acted on alone, and records nothing for an unusable report', async () => {
      rows = [
        finding({
          status: BugFindingStatus.REJECTED,
          metadata: { independentVerification: 'pending' },
        }),
      ];
      await service.recordVerdict('f-1', {
        verdict: 'refuted',
        refutation: 'x',
      });
      expect(bugFindingService.setStatus).not.toHaveBeenCalled();

      expect(
        await service.recordVerdict('f-1', { verdict: 'perhaps' }),
      ).toBeNull();
    });

    it('swallows a refused auto-fix into a log line rather than failing the verdict', async () => {
      policy.assertMayFix.mockRejectedValue(new ForbiddenException('budget'));
      await expect(
        service.recordVerdict('f-1', {
          verdict: 'confirmed',
          confidence: 0.9,
          reproduction: 'repro',
        }),
      ).resolves.toMatchObject({ verdict: 'confirmed' });
      expect(fixSession.startByAgent).not.toHaveBeenCalled();
    });
  });
});
