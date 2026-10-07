import { BugHunterFinderService } from '../bug-hunter-finder.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

const run = (overrides: Partial<BugHuntRun> = {}): BugHuntRun =>
  ({
    id: 'run-1',
    repo: 'ally-web',
    trigger: BugHuntTrigger.SCHEDULED,
    metadata: {},
    createdAt: new Date('2026-10-07T00:30:00Z'),
    ...overrides,
  }) as BugHuntRun;

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    runId: 'run-1',
    source: BugFindingSource.CODE_REVIEW,
    status: BugFindingStatus.NEW,
    proven: false,
    title: 'Something',
    description: 'd',
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  }) as BugFinding;

describe('BugHunterFinderService', () => {
  let decisions: { decide: jest.Mock };
  let findingRepository: { update: jest.Mock; find: jest.Mock };
  let runRepository: { findLastCompleted: jest.Mock; listRunning: jest.Mock };
  let bugHunterService: {
    setRunMetadata: jest.Mock;
    appendEvent: jest.Mock;
    appendFindingEvent: jest.Mock;
    getSettings: jest.Mock;
  };
  let bugFindingService: { setStatus: jest.Mock; listKnownNonBugs: jest.Mock };
  let github: { hasCommitsSince: jest.Mock };
  let sweepService: { trigger: jest.Mock };
  let service: BugHunterFinderService;

  /** The decision service as a pass-through: the rule acts, with an optional model override per point. */
  const decideWith = (
    overrides: Record<string, { pick: unknown; confidence?: number }> = {},
  ) =>
    jest.fn().mockImplementation(async (req) => {
      const o = overrides[req.point];
      const pick = o ? (req.validate(o.pick) ?? req.rule()) : req.rule();
      return {
        pick,
        owner: o ? 'model' : 'rule',
        shadowPick: o ? req.rule() : null,
        reason: o ? 'model said so' : 'rule',
        confidence: o?.confidence ?? null,
        record: { id: `dec-${req.point}` },
      };
    });

  beforeEach(() => {
    decisions = { decide: decideWith() };
    findingRepository = {
      update: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    runRepository = {
      findLastCompleted: jest.fn().mockResolvedValue(null),
      listRunning: jest.fn().mockResolvedValue([]),
    };
    bugHunterService = {
      setRunMetadata: jest.fn(),
      appendEvent: jest.fn(),
      appendFindingEvent: jest.fn(),
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.AI }),
    };
    bugFindingService = {
      setStatus: jest.fn(),
      listKnownNonBugs: jest.fn().mockResolvedValue([]),
    };
    github = { hasCommitsSince: jest.fn().mockResolvedValue(false) };
    sweepService = {
      trigger: jest.fn().mockResolvedValue({ id: 'run-light' }),
    };
    service = new BugHunterFinderService(
      decisions as never,
      {
        forRepo: jest
          .fn()
          .mockResolvedValue({ bySense: {}, byModel: {}, rows: [] }),
      } as never,
      bugHunterService as never,
      bugFindingService as never,
      findingRepository as never,
      runRepository as never,
      {
        get: jest.fn().mockResolvedValue({
          engine: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          escalationModel: 'gemini-2.5-pro',
        }),
      } as never,
      { hasLogGroup: () => true, hasExternalSignal: () => true } as never,
      github as never,
      sweepService as never,
    );
  });

  describe('ensurePlan', () => {
    it('makes D1 and D2 once, stores the plan on the run, and writes it to the timeline', async () => {
      const plan = await service.ensurePlan(run());

      expect(plan.trigger).toBe('scheduled');
      expect(plan.senses).toEqual([
        'tests',
        'code_review',
        'production_log',
        'browser_errors',
        'reported_bugs',
      ]);
      expect(plan.model).toEqual({ engine: 'gemini', model: 'gemini-2.5-pro' });
      expect(plan.decisions).toEqual({ D1: 'dec-D1', D2: 'dec-D2' });
      expect(decisions.decide).toHaveBeenCalledTimes(2);
      expect(decisions.decide.mock.calls[0][0]).toMatchObject({
        point: 'D1',
        modelOwned: true,
        runId: 'run-1',
      });
      expect(bugHunterService.setRunMetadata).toHaveBeenCalledWith('run-1', {
        finder: expect.objectContaining({ senses: plan.senses }),
      });
      expect(bugHunterService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ stage: BugHuntEventStage.FINDER_RESULT }),
      );
    });

    it('returns a stored plan without deciding again', async () => {
      const stored = {
        trigger: 'merge',
        light: true,
        senses: ['code_review'],
        model: { engine: 'gemini', model: 'gemini-2.5-flash' },
        decisions: { D1: 'a', D2: 'b' },
        plannedAt: 'x',
      };
      const plan = await service.ensurePlan(
        run({ metadata: { finder: stored } }),
      );
      expect(plan).toEqual(stored);
      expect(decisions.decide).not.toHaveBeenCalled();
    });

    it('rule picks a narrow sense set for a light pass after a merge, and the model may override within the menu', async () => {
      const r = run({
        trigger: BugHuntTrigger.MANUAL,
        metadata: { finderTrigger: 'merge', finderLight: true },
      });
      let plan = await service.ensurePlan(r);
      expect(plan.trigger).toBe('merge');
      expect(plan.light).toBe(true);
      expect(plan.senses).toEqual(['code_review', 'tests']);

      decisions.decide = decideWith({
        D1: { pick: ['code_review', 'browser_errors', 'nonsense'] },
        D2: { pick: { engine: 'opencode', model: 'gemini-2.5-pro' } },
      });
      plan = await service.ensurePlan(
        run({
          trigger: BugHuntTrigger.MANUAL,
          metadata: { finderTrigger: 'merge', finderLight: true },
        }),
      );
      expect(plan.senses).toEqual(['code_review', 'browser_errors']);
      expect(plan.model).toEqual({
        engine: 'opencode',
        model: 'gemini-2.5-pro',
      });
    });
  });

  describe('triageNew', () => {
    it('leaves a "verify" finding alone and records the triage on it', async () => {
      await service.triageNew([finding()], 'run-1');
      expect(bugFindingService.setStatus).not.toHaveBeenCalled();
      expect(findingRepository.update).toHaveBeenCalledWith('f-1', {
        metadata: expect.objectContaining({
          triage: expect.objectContaining({
            pick: 'verify',
            acted: 'verify',
            owner: 'rule',
          }),
        }),
      });
    });

    it('holds a finding the model wants a person to see', async () => {
      decisions.decide = decideWith({ D3: { pick: 'hold', confidence: 0.6 } });
      await service.triageNew([finding()], 'run-1');
      expect(bugFindingService.setStatus).toHaveBeenCalledWith('f-1', {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
      expect(bugHunterService.appendFindingEvent).toHaveBeenCalledWith(
        expect.objectContaining({ stage: BugHuntEventStage.FINDER_RESULT }),
      );
    });

    it('drops only when the model is sure, dismissing as not a bug with the reason', async () => {
      decisions.decide = decideWith({ D3: { pick: 'drop', confidence: 0.9 } });
      await service.triageNew([finding()], 'run-1');
      expect(bugFindingService.setStatus).toHaveBeenCalledWith(
        'f-1',
        expect.objectContaining({
          status: BugFindingStatus.DISMISSED,
          decisionReason: BugFindingDecisionReason.NOT_A_BUG,
          decisionNote: 'model said so',
        }),
      );
      expect(bugHunterService.appendFindingEvent).toHaveBeenCalledWith(
        expect.objectContaining({ stage: BugHuntEventStage.DECISION_RECORDED }),
      );
    });

    it('turns an unsure drop into a verify', async () => {
      decisions.decide = decideWith({ D3: { pick: 'drop', confidence: 0.5 } });
      await service.triageNew([finding()], 'run-1');
      expect(bugFindingService.setStatus).not.toHaveBeenCalled();
      expect(findingRepository.update).toHaveBeenCalledWith('f-1', {
        metadata: expect.objectContaining({
          triage: expect.objectContaining({ pick: 'drop', acted: 'verify' }),
        }),
      });
    });

    it('skips proven findings, human reports and findings already triaged', async () => {
      await service.triageNew(
        [
          finding({ id: 'p', proven: true }),
          finding({ id: 'h', source: BugFindingSource.REPORTED_BUG }),
          finding({ id: 't', metadata: { triage: { pick: 'verify' } } }),
        ],
        'run-1',
      );
      expect(decisions.decide).not.toHaveBeenCalled();
    });
  });

  describe('runEventTriggers', () => {
    it('starts a light pass after a human report and marks the report as triggered', async () => {
      runRepository.findLastCompleted.mockResolvedValue({
        finishedAt: new Date(Date.now() - 3 * 3600_000),
      });
      findingRepository.find.mockImplementation(({ where }) =>
        Promise.resolve(
          where.repo === 'ally-web' &&
            where.source === BugFindingSource.REPORTED_BUG
            ? [
                finding({
                  id: 'rep',
                  source: BugFindingSource.REPORTED_BUG,
                  createdAt: new Date(),
                }),
              ]
            : [],
        ),
      );

      await service.runEventTriggers();

      expect(sweepService.trigger).toHaveBeenCalledWith(
        'ally-web',
        null,
        false,
        { kind: 'report', light: true },
      );
      expect(findingRepository.update).toHaveBeenCalledWith('rep', {
        metadata: expect.objectContaining({ finderTriggered: 'run-light' }),
      });
    });

    it('starts a light pass after a merge, but not within the debounce window or while a run is live', async () => {
      runRepository.findLastCompleted.mockResolvedValue({
        finishedAt: new Date(Date.now() - 3 * 3600_000),
      });
      github.hasCommitsSince.mockImplementation((repo) =>
        Promise.resolve(repo === 'ally-be'),
      );
      await service.runEventTriggers();
      expect(sweepService.trigger).toHaveBeenCalledWith(
        'ally-be',
        null,
        false,
        { kind: 'merge', light: true },
      );

      sweepService.trigger.mockClear();
      runRepository.findLastCompleted.mockResolvedValue({
        finishedAt: new Date(Date.now() - 10 * 60_000),
      });
      await service.runEventTriggers();
      expect(sweepService.trigger).not.toHaveBeenCalled();

      runRepository.findLastCompleted.mockResolvedValue({
        finishedAt: new Date(Date.now() - 3 * 3600_000),
      });
      runRepository.listRunning.mockResolvedValue([{ repo: 'ally-be' }]);
      await service.runEventTriggers();
      expect(sweepService.trigger).not.toHaveBeenCalled();
    });

    it('does nothing while Bug Hunter is off', async () => {
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.OFF,
      });
      await service.runEventTriggers();
      expect(runRepository.listRunning).not.toHaveBeenCalled();
    });
  });
});
