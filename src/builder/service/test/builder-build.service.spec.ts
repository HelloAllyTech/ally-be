import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BuilderBuildService } from '../builder-build.service';
import {
  BuilderEventType,
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
} from '../../enum/builder.enum';

const readySession = (overrides: Record<string, any> = {}) => ({
  id: 'session-1',
  slug: 'add-a-thing',
  title: 'Add a thing',
  status: BuilderSessionStatus.PRD_READY,
  repos: ['ally-be'],
  engine: 'claude-code',
  model: 'claude-sonnet-5',
  budgetUsd: null,
  totalCostUsd: '0',
  createdBy: 1,
  ...overrides,
});

describe('BuilderBuildService', () => {
  let service: BuilderBuildService;
  let github: {
    isConfigured: boolean;
    dispatchWorkflow: jest.Mock;
    findRunSince: jest.Mock;
    cancelRun: jest.Mock;
    getRun: jest.Mock;
  };
  let sessionRepository: {
    update: jest.Mock;
    count: jest.Mock;
    findOne: jest.Mock;
    increment: jest.Mock;
  };
  let runRepository: {
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findOne: jest.Mock;
    listActive: jest.Mock;
    nextSequence: jest.Mock;
  };
  let eventRepository: { listByRun: jest.Mock };
  let questionRepository: { isGroupComplete: jest.Mock; update: jest.Mock };
  let settingsService: { get: jest.Mock };
  let notificationService: {
    buildCompleted: jest.Mock;
    buildFailed: jest.Mock;
    budgetReached: jest.Mock;
  };

  beforeEach(() => {
    github = {
      isConfigured: true,
      dispatchWorkflow: jest.fn().mockResolvedValue(new Date()),
      findRunSince: jest.fn().mockResolvedValue(null),
      cancelRun: jest.fn().mockResolvedValue(undefined),
      getRun: jest.fn().mockResolvedValue(null),
    };
    sessionRepository = {
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(readySession()),
      increment: jest.fn(),
    };
    runRepository = {
      save: jest.fn(async (run) => ({ id: 'run-1', ...run })),
      create: jest.fn((run) => run),
      update: jest.fn(),
      findOne: jest.fn(),
      listActive: jest.fn().mockResolvedValue([]),
      nextSequence: jest.fn().mockResolvedValue(1),
    };
    eventRepository = { listByRun: jest.fn().mockResolvedValue([]) };
    questionRepository = {
      isGroupComplete: jest.fn().mockResolvedValue(true),
      update: jest.fn(),
    };
    settingsService = {
      get: jest
        .fn()
        .mockResolvedValue({ enabled: true, maxConcurrentBuilds: 3 }),
    };
    notificationService = {
      buildCompleted: jest.fn(),
      buildFailed: jest.fn(),
      budgetReached: jest.fn(),
    };

    service = new BuilderBuildService(
      {
        publicApiBaseUrl: 'http://be',
        builder: { buildModel: 'claude-sonnet-5' },
      } as any,
      github as any,
      sessionRepository as any,
      runRepository as any,
      eventRepository as any,
      questionRepository as any,
      settingsService as any,
      notificationService as any,
    );
  });

  describe('startBuild', () => {
    it('dispatches with the run id, so the runner can call back from its first step', async () => {
      const run = await service.startBuild(readySession() as any, 1);

      expect(run.id).toBe('run-1');
      // The row must exist BEFORE the dispatch: workflow_dispatch answers 204
      // with no run id, so the runner is handed ours as an input.
      const saveOrder = runRepository.save.mock.invocationCallOrder[0];
      const dispatchOrder = github.dispatchWorkflow.mock.invocationCallOrder[0];
      expect(saveOrder).toBeLessThan(dispatchOrder);

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            run_id: 'run-1',
            session_id: 'session-1',
            mode: 'build',
            repos: '["ally-be"]',
          }),
        }),
      );
    });

    it('stamps dispatchedAt before the POST, so clock skew can only widen the search window', async () => {
      const before = Date.now();
      await service.startBuild(readySession() as any, 1);
      const created = runRepository.create.mock.calls[0][0];

      expect(created.dispatchedAt.getTime()).toBeLessThanOrEqual(before);
    });

    it('refuses when the kill switch is off, and says which control stopped it', async () => {
      settingsService.get.mockResolvedValue({
        enabled: false,
        maxConcurrentBuilds: 3,
      });

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/switched off/i);
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('refuses when GitHub is not configured', async () => {
      github.isConfigured = false;

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('refuses at the concurrency ceiling', async () => {
      sessionRepository.count.mockResolvedValue(3);

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/already running/i);
    });

    it('refuses once the session has spent its budget', async () => {
      await expect(
        service.startBuild(
          readySession({ budgetUsd: '10', totalCostUsd: '10.5' }) as any,
          1,
        ),
      ).rejects.toThrow(/budget/i);
    });

    it('refuses from a PRD that is not ready', async () => {
      await expect(
        service.startBuild(
          readySession({ status: BuilderSessionStatus.INTERVIEWING }) as any,
          1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fails the run and the session when the dispatch itself throws', async () => {
      github.dispatchWorkflow.mockRejectedValue(new Error('GitHub is down'));

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/GitHub is down/);
      // Otherwise the row sits QUEUED until reconcile times it out half an
      // hour later, with nothing ever having run against it.
      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ status: BuilderRunStatus.FAILED }),
      );
    });
  });

  describe('resumeFromQuestions', () => {
    const pausedRun = {
      id: 'run-1',
      sessionId: 'session-1',
      branches: { 'ally-be': 'builder/add-a-thing' },
    };

    it('waits for the whole question group before dispatching', async () => {
      questionRepository.isGroupComplete.mockResolvedValue(false);

      const result = await service.resumeFromQuestions(
        readySession({ status: BuilderSessionStatus.WAITING_FOR_INPUT }) as any,
        pausedRun as any,
        'group-1',
        1,
      );

      expect(result).toBeNull();
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('carries the paused branches through, so the resume continues rather than restarts', async () => {
      await service.resumeFromQuestions(
        readySession({ status: BuilderSessionStatus.WAITING_FOR_INPUT }) as any,
        pausedRun as any,
        'group-1',
        1,
      );

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          inputs: expect.objectContaining({
            mode: BuilderRunMode.RESUME,
            branches: '{"ally-be":"builder/add-a-thing"}',
          }),
        }),
      );
    });
  });

  describe('cancelRun', () => {
    const run = {
      id: 'run-1',
      sessionId: 'session-1',
      githubRunId: '99',
      dispatchedAt: new Date(),
    };

    it('lands the DB write even when GitHub refuses the cancel', async () => {
      github.cancelRun.mockRejectedValue(new Error('409 already completed'));

      await expect(service.cancelRun(run as any, 7)).resolves.toBeUndefined();

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({
          status: BuilderRunStatus.CANCELLED,
          cancelledBy: 7,
        }),
      );
    });

    it('supersedes pending questions, so a late answer cannot resume a cancelled build', async () => {
      await service.cancelRun(run as any, 7);

      expect(questionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-1' }),
        expect.objectContaining({ status: 'superseded' }),
      );
    });

    it('looks the run up inline when it was never correlated', async () => {
      github.findRunSince.mockResolvedValue({ id: '123' });

      await service.cancelRun({ ...run, githubRunId: null } as any, 7);

      expect(github.cancelRun).toHaveBeenCalledWith('ally-be', '123');
    });
  });

  describe('reconcile', () => {
    it('treats a GitHub-completed run that is waiting for input as healthy', async () => {
      const run = {
        id: 'run-1',
        sessionId: 'session-1',
        githubRunId: '99',
        dispatchedAt: new Date(),
        status: BuilderRunStatus.RUNNING,
      };
      runRepository.listActive.mockResolvedValue([run]);
      runRepository.findOne.mockResolvedValue({
        ...run,
        status: BuilderRunStatus.WAITING_FOR_INPUT,
      });
      github.getRun.mockResolvedValue({
        status: 'completed',
        conclusion: 'success',
      });

      await service.reconcile();

      // A pause is a deliberate exit 0. Without this rule every pause would be
      // reported as a finished build five minutes later.
      expect(runRepository.update).not.toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ status: BuilderRunStatus.SUCCEEDED }),
      );
    });

    it('fails a dispatch GitHub never registered', async () => {
      runRepository.listActive.mockResolvedValue([
        {
          id: 'run-1',
          sessionId: 'session-1',
          githubRunId: null,
          dispatchedAt: new Date(Date.now() - 40 * 60_000),
          status: BuilderRunStatus.QUEUED,
        },
      ]);

      await service.reconcile();

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ status: BuilderRunStatus.FAILED }),
      );
    });

    it('keeps going after one run throws', async () => {
      runRepository.listActive.mockResolvedValue([
        {
          id: 'bad',
          sessionId: 's',
          githubRunId: '1',
          dispatchedAt: new Date(),
          status: BuilderRunStatus.RUNNING,
        },
        {
          id: 'good',
          sessionId: 's',
          githubRunId: '2',
          dispatchedAt: new Date(),
          status: BuilderRunStatus.RUNNING,
        },
      ]);
      github.getRun
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ status: 'in_progress', conclusion: null });

      await expect(service.reconcile()).resolves.toBeUndefined();
      expect(github.getRun).toHaveBeenCalledTimes(2);
    });
  });

  describe('recordRunCost', () => {
    it('rolls spend onto the session so a retry is measured against what is left', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '4.0000', budgetUsd: '25' }),
      );

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        {
          totalCostUsd: 6.5,
        },
      );

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { totalCostUsd: '10.5000' },
      );
      expect(notificationService.budgetReached).not.toHaveBeenCalled();
    });

    it('says so once when the budget line is crossed', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '20', budgetUsd: '25' }),
      );

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        {
          totalCostUsd: 6,
        },
      );

      expect(notificationService.budgetReached).toHaveBeenCalled();
    });
  });

  describe('buildResumeContext', () => {
    it('condenses the previous run rather than replaying its transcript', async () => {
      eventRepository.listByRun.mockResolvedValue([
        { type: BuilderEventType.STAGE_CHANGE, payload: { stage: 'PLANNING' } },
        {
          type: BuilderEventType.PLAN,
          payload: { text: 'Touch three files.' },
        },
        { type: BuilderEventType.STAGE_CHANGE, payload: { stage: 'CODING' } },
        { type: BuilderEventType.FILE_EDIT, payload: { path: 'src/a.ts' } },
        { type: BuilderEventType.FILE_EDIT, payload: { path: 'src/b.ts' } },
        // Duplicated on purpose — the same file edited twice is one file.
        { type: BuilderEventType.FILE_EDIT, payload: { path: 'src/a.ts' } },
        {
          type: BuilderEventType.TODO,
          payload: { items: [{ text: 'Write the endpoint', status: 'done' }] },
        },
        { type: BuilderEventType.TEST_OUTPUT, payload: { text: '3 passing' } },
      ]);

      const context = await service.buildResumeContext('run-1');

      expect(context).toContain('PLANNING → CODING');
      expect(context).toContain('Touch three files.');
      expect(context).toContain('src/a.ts');
      expect(context).toContain('Write the endpoint');
      expect(context).toContain('3 passing');
      // Two distinct files, not three edits.
      expect(context).toContain('(2)');
    });

    it('returns empty for a run with no events rather than inventing a handover', async () => {
      eventRepository.listByRun.mockResolvedValue([]);
      await expect(service.buildResumeContext('run-1')).resolves.toBe('');
    });
  });
});
