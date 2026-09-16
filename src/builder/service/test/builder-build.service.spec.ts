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
import {
  BUILDER_BUDGET_HOLD_POLL_SECONDS,
  BUILDER_BUDGET_HOLD_SECONDS,
} from '../../constants/builder.constants';

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
    count: jest.Mock;
  };
  let eventRepository: { listByRun: jest.Mock; latestOfType: jest.Mock };
  let pullRequestRepository: { increment: jest.Mock; findOne: jest.Mock };
  let questionRepository: { isGroupComplete: jest.Mock; update: jest.Mock };
  let settingsService: { get: jest.Mock };
  let notificationService: {
    buildCompleted: jest.Mock;
    buildFailed: jest.Mock;
    budgetReached: jest.Mock;
    budgetHold: jest.Mock;
  };
  let eventService: { record: jest.Mock };
  let redisService: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let exemplarService: { archiveSession: jest.Mock };
  let epicService: {
    nextPending: jest.Mock;
    markStatus: jest.Mock;
    listBySession: jest.Mock;
  };
  let llmUsage: { record: jest.Mock };
  let llmModelsRepository: { find: jest.Mock };
  let prdService: { getOrCreateDoc: jest.Mock };

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
      count: jest.fn().mockResolvedValue(0),
      listRecent: jest.fn().mockResolvedValue([]),
    };
    eventRepository = {
      listByRun: jest.fn().mockResolvedValue([]),
      latestOfType: jest.fn().mockResolvedValue(null),
    };
    pullRequestRepository = {
      increment: jest.fn(),
      findOne: jest.fn(),
    };
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
      budgetHold: jest.fn(),
      automationPaused: jest.fn(),
      fixRunStarted: jest.fn(),
    };
    // Annotations the service writes onto a run's own log (a budget raise, a
    // hold). Recorded through the event service so they also push over the
    // socket, which is why this is stubbed rather than the repository.
    eventService = { record: jest.fn() };
    // The dispatch mutex: granted by default, so only the test that cares
    // about a double dispatch has to think about it.
    redisService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
    };
    // The flywheel archives a finished session; a failure there must never
    // reach the run that just settled.
    exemplarService = { archiveSession: jest.fn().mockResolvedValue(null) };
    // Epic mode is off unless a test opts in: `nextPending` returning null is
    // an ordinary single-milestone build.
    epicService = {
      nextPending: jest.fn().mockResolvedValue(null),
      markStatus: jest.fn(),
      listBySession: jest.fn().mockResolvedValue([]),
    };
    // Build-half spend goes to the unified usage store as well as the run row.
    llmUsage = { record: jest.fn().mockResolvedValue(undefined) };
    // Sizing reads the PRD to decide what planning is worth. A small default,
    // so a test that does not care gets the cheap planner and says nothing.
    llmModelsRepository = { find: jest.fn().mockResolvedValue([]) };
    prdService = {
      getOrCreateDoc: jest
        .fn()
        .mockResolvedValue({ draft: { requirements: [], technicalPlan: '' } }),
    };

    service = new BuilderBuildService(
      {
        publicApiBaseUrl: 'http://be',
        builder: {
          coderModel: 'claude-sonnet-5',
          plannerModel: 'claude-opus-5',
          verifierModel: 'claude-opus-5',
          mechanicalModel: 'claude-haiku-4-5',
        },
      } as any,
      github as any,
      sessionRepository as any,
      runRepository as any,
      eventRepository as any,
      questionRepository as any,
      // Steering notes get superseded when a run is cancelled; nothing else in
      // these tests touches them.
      { supersedePending: jest.fn().mockResolvedValue(0) } as any,
      // The model-selection dataset is written as a byproduct and must never
      // decide whether a build succeeds — these tests assert the build, not
      // the telemetry.
      { recordArm: jest.fn(), recordGate: jest.fn() } as any,
      // The model catalog. Empty means "nothing is marked retired", which is
      // the state every other test in this file assumes.
      llmModelsRepository as any,
      pullRequestRepository as any,
      settingsService as any,
      notificationService as any,
      eventService as any,
      redisService as any,
      exemplarService as any,
      epicService as any,
      llmUsage as any,
      prdService as any,
    );
  });

  describe('sizing a build', () => {
    const dispatchedModels = () =>
      JSON.parse(
        github.dispatchWorkflow.mock.calls[0][0].inputs.models as string,
      );

    it('plans a small PRD on the coder tier, not Opus', async () => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: {
          requirements: [{ id: 'R1' }, { id: 'R2' }],
          technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'small' }] },
        },
      });

      await service.startBuild(readySession() as any, 1);

      const models = dispatchedModels();
      // The first real build was exactly this shape and paid $7.85 for an Opus
      // plan of a two-route change. Dropping to the coder tier took that to a
      // $4.89 median and it was still 25% of everything Builder spent, so a
      // small build now plans on the cheapest tier there is.
      expect(models.planner).toBe('claude-haiku-4-5');
      expect(models.size).toBe('small');
      expect(models.effort).toBe('low');
      expect(models.plannerMaxTurns).toBe(20);
      expect(models.budgets.plan).toBe(1);
    });

    /**
     * An unconfigured mechanical model must not hand the runner an empty
     * `--model`: a cost optimisation that can fail the build is not one.
     */
    it('falls back to the coder tier when no mechanical model is configured', async () => {
      (service as any).configService = {
        publicApiBaseUrl: 'http://be',
        builder: {
          coderModel: 'claude-sonnet-5',
          plannerModel: 'claude-opus-5',
          verifierModel: 'claude-opus-5',
        },
      };
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: {
          requirements: [{ id: 'R1' }, { id: 'R2' }],
          technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'small' }] },
        },
      });

      await service.startBuild(readySession() as any, 1);

      expect(dispatchedModels().planner).toBe('claude-sonnet-5');
    });

    it('keeps Opus for a cross-repo build', async () => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: {
          requirements: Array.from({ length: 6 }, (_, i) => ({ id: `R${i}` })),
          technicalPlan: {
            repos: [
              { repo: 'ally-be', changesMd: 'x'.repeat(2000) },
              { repo: 'ally-web', changesMd: 'y'.repeat(2000) },
            ],
          },
        },
      });

      await service.startBuild(
        readySession({ repos: ['ally-be', 'ally-web'] }) as any,
        1,
      );

      expect(dispatchedModels().planner).toBe('claude-opus-5');
    });

    it('lets an explicit planner override win over sizing', async () => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: { requirements: [{ id: 'R1' }], technicalPlan: null },
      });

      await service.startBuild(readySession() as any, 1, {
        plannerModel: 'claude-opus-5',
      });

      // An admin who picked a planner meant it.
      expect(dispatchedModels().planner).toBe('claude-opus-5');
    });

    it('plans at the default tier when the PRD cannot be read', async () => {
      prdService.getOrCreateDoc.mockRejectedValue(new Error('gone'));

      await service.startBuild(readySession() as any, 1);

      // An unreadable PRD is a reason to spend the default, not to refuse.
      expect(dispatchedModels().size).toBe('medium');
      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });
  });

  /**
   * The escalation ladder.
   *
   * The loop used to re-run the model that had just failed the gate, four
   * times, so a run that exhausted its attempts failed without ever trying
   * anything stronger. Two properties keep the fix from making anything worse:
   * the first attempt is never weakened, and the ladder always has somewhere
   * to go.
   */
  /**
   * A build refused before it costs anything, rather than one that burns its
   * attempts on a model that no longer answers.
   *
   * The failure this replaces is silent: run-engine.sh has no `set -e`, so a
   * dead model id lets the script carry on, gate an unchanged tree, block, and
   * retry — and on a small build's ladder that is two of four attempts gone
   * before it reaches a different tier, with a test-gate error as the only
   * visible symptom.
   */
  describe('model preflight', () => {
    it('refuses a build whose coder tier is marked retired', async () => {
      llmModelsRepository.find.mockResolvedValue([
        { model: 'claude-sonnet-5', active: false },
      ]);

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/retired/i);
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('names the model, so the admin knows which tier to change', async () => {
      llmModelsRepository.find.mockResolvedValue([
        { model: 'claude-opus-5', active: false },
      ]);

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/claude-opus-5/);
    });

    /**
     * The catalog is admin-maintained and lags reality in both directions.
     * Refusing a build because nobody has added a row yet would be a worse
     * failure than the one this prevents, so only an explicit retirement
     * blocks.
     */
    it('allows a model the catalog has never heard of', async () => {
      llmModelsRepository.find.mockResolvedValue([]);

      await service.startBuild(readySession() as any, 1);

      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });

    it('allows the build when the catalog itself cannot be read', async () => {
      llmModelsRepository.find.mockRejectedValue(new Error('db down'));

      await service.startBuild(readySession() as any, 1);

      // A database hiccup is not evidence a model is gone.
      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });

    /** Escalation rungs are models too — a retired one is found at attempt 3. */
    it('checks the ladder, not just the three named tiers', async () => {
      llmModelsRepository.find.mockResolvedValue([]);

      await service.startBuild(readySession() as any, 1);

      const asked = llmModelsRepository.find.mock.calls[0][0].where.model;
      const wanted = (asked as { _value: string[] })._value ?? asked;
      expect(wanted).toEqual(expect.arrayContaining(['claude-opus-5']));
    });
  });

  describe('the coder escalation ladder', () => {
    const dispatchedModels = () =>
      JSON.parse(
        github.dispatchWorkflow.mock.calls[0][0].inputs.models as string,
      );

    const smallPrd = {
      draft: {
        requirements: [{ id: 'R1' }, { id: 'R2' }],
        technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'small' }] },
      },
    };

    /**
     * The load-bearing guarantee. This ships as escalation only: if entry 0
     * ever drifted below the coder tier, every build would get worse on its
     * first attempt to buy a saving nobody has measured yet.
     */
    it('never weakens the first attempt', async () => {
      prdService.getOrCreateDoc.mockResolvedValue(smallPrd);

      await service.startBuild(readySession() as any, 1);

      const models = dispatchedModels();
      expect(models.coderLadder[0]).toBe(models.coder);
    });

    it('escalates to a stronger tier once the gate keeps refusing', async () => {
      prdService.getOrCreateDoc.mockResolvedValue(smallPrd);

      await service.startBuild(readySession() as any, 1);

      const ladder = dispatchedModels().coderLadder;
      expect(ladder).toEqual([
        'claude-sonnet-5',
        'claude-sonnet-5',
        'claude-opus-5',
        'claude-opus-5',
      ]);
    });

    /**
     * A large build's second failure is rarely the kind a third cheap attempt
     * fixes, and another failed attempt costs more.
     */
    it('escalates a large build sooner than a small one', async () => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: {
          requirements: Array.from({ length: 12 }, (_, i) => ({
            id: `R${i}`,
          })),
          technicalPlan: {
            repos: [
              { repo: 'ally-be', changesMd: 'x'.repeat(4000) },
              { repo: 'ally-web', changesMd: 'y'.repeat(4000) },
            ],
          },
        },
      });

      await service.startBuild(readySession() as any, 1);

      const models = dispatchedModels();
      expect(models.size).toBe('large');
      expect(models.coderLadder[1]).toBe('claude-opus-5');
    });

    it('carries the ladder on the dispatch input the runner reads', async () => {
      prdService.getOrCreateDoc.mockResolvedValue(smallPrd);

      await service.startBuild(readySession() as any, 1);

      const ladder = dispatchedModels().coderLadder;
      expect(Array.isArray(ladder)).toBe(true);
      expect(ladder.length).toBeGreaterThan(1);
      // Every rung has to name a real model — an empty string would make the
      // runner fall back silently and the escalation would simply not happen.
      for (const rung of ladder) expect(rung).toBeTruthy();
    });
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
      // Counted on runs holding a runner, not sessions: a session parked on a
      // question occupies no runner, and one session can hold several runs.
      runRepository.count.mockResolvedValue(3);

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

  describe('engine resolution', () => {
    const dispatchedEngine = () =>
      github.dispatchWorkflow.mock.calls[0][0].inputs.engine as string;

    it('lets an explicit override win over everything else', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        defaultEngine: 'gemini',
      });

      await service.startBuild(
        readySession({ engine: 'claude-code' }) as any,
        1,
        {
          engine: 'codex',
        },
      );

      expect(dispatchedEngine()).toBe('codex');
    });

    it("falls through to the session's own engine when no override is given", async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        defaultEngine: 'gemini',
      });

      await service.startBuild(
        readySession({ engine: 'claude-code' }) as any,
        1,
      );

      expect(dispatchedEngine()).toBe('claude-code');
    });

    it("falls through to the admin's configured default when the session has none — the field a settings picker used to change and nothing read", async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        defaultEngine: 'gemini',
      });

      await service.startBuild(readySession({ engine: null }) as any, 1);

      expect(dispatchedEngine()).toBe('gemini');
    });

    it('falls all the way back to claude-code when nothing at all is configured', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        defaultEngine: null,
      });

      await service.startBuild(readySession({ engine: null }) as any, 1);

      expect(dispatchedEngine()).toBe('claude-code');
    });
  });

  describe('spend and concurrency guards', () => {
    it('refuses a dispatch while another is already starting for the session', async () => {
      // Two admins answering the last question of a group at once, or one
      // double-click, used to send two runners at the same branches.
      redisService.acquireLock.mockResolvedValue(false);

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/already being started/i);
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('releases the dispatch lock even when the dispatch throws', async () => {
      github.dispatchWorkflow.mockRejectedValue(new Error('GitHub is down'));

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/GitHub is down/);
      // Held to its TTL instead, this would refuse the retry for a minute.
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('refuses once the session has used its runner minutes', async () => {
      // A separate ceiling from dollars on purpose: a run can be cheap in
      // tokens and still hold a runner for two hours.
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        maxRunnerMinutes: 600,
      });

      await expect(
        service.startBuild(readySession({ runnerMinutes: 640 }) as any, 1),
      ).rejects.toThrow(/runner minutes/i);
    });

    it('allows a dispatch when minutes are under the ceiling', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        maxRunnerMinutes: 600,
      });

      await expect(
        service.startBuild(readySession({ runnerMinutes: 120 }) as any, 1),
      ).resolves.toBeTruthy();
    });
  });

  describe('findCancellableRun', () => {
    it('includes a paused run, which holds no runner but does hold questions', async () => {
      runRepository.findOne.mockResolvedValue({ id: 'run-9' });

      await service.findCancellableRun('session-1');

      const where = runRepository.findOne.mock.calls[0][0].where;
      expect(where.status._value ?? where.status.value).toEqual(
        expect.arrayContaining([BuilderRunStatus.WAITING_FOR_INPUT]),
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

    it('fails a green job that never reported an outcome', async () => {
      const run = {
        id: 'run-1',
        sessionId: 'session-1',
        githubRunId: '99',
        dispatchedAt: new Date(),
        status: BuilderRunStatus.RUNNING,
      };
      runRepository.listActive.mockResolvedValue([run]);
      runRepository.findOne.mockResolvedValue(run);
      github.getRun.mockResolvedValue({
        status: 'completed',
        conclusion: 'success',
      });

      await service.reconcile();

      // `claude -p` exits 0 whenever the agent produces a final response,
      // including mid-protocol — so a green job proves the runner exited, not
      // that it shipped anything. A run reports its own outcome or it did not
      // finish. Settling SUCCEEDED here reported builds that opened no PR.
      expect(runRepository.update).not.toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ status: BuilderRunStatus.SUCCEEDED }),
      );
      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ status: BuilderRunStatus.FAILED }),
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
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: null,
        costUsd: null,
      });
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
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: null,
        costUsd: null,
      });
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

    it('bills every phase of the tiered loop, not just the coding pass', async () => {
      // The planner and verifier are separate engine invocations. Reporting
      // one phase must not overwrite another's spend, or the two passes that
      // exist purely to raise quality would be invisible to the budget.
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: { phases: { plan: { model: 'planner', usd: 2 } } },
        costUsd: '2.0000',
      });
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '2.0000', budgetUsd: '25' }),
      );

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        { phase: 'verify-1', model: 'verifier', totalCostUsd: 3 },
      );

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ costUsd: '5.0000' }),
      );
      // Only the delta reaches the session: the plan's $2 was already counted.
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { totalCostUsd: '5.0000' },
      );
    });

    it('bills the unified usage store per model, not just the run row', async () => {
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: null,
        costUsd: '0',
      });

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        {
          phase: 'code-1',
          model: 'claude-sonnet-5',
          totalCostUsd: 8.92,
          modelUsage: {
            'claude-sonnet-5': {
              inputTokens: 276,
              outputTokens: 64655,
              cacheReadInputTokens: 23383748,
              cacheCreationInputTokens: 243366,
            },
            // A subagent the coder spawned. Its spend belongs to its own model,
            // or the store's per-model aggregates lie.
            'claude-haiku-4-5': { inputTokens: 17892, outputTokens: 15 },
          },
        },
      );

      expect(llmUsage.record).toHaveBeenCalledTimes(2);
      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-5',
          task: 'builder_build',
          promptTokens: 276,
          completionTokens: 64655,
          // Both counters: a cache read and a cache write cost very different
          // amounts, so one number cannot express the spend.
          cachedTokens: 23383748,
          cacheCreationTokens: 243366,
          metadata: expect.objectContaining({
            phase: 'code-1',
            builderRunId: 'run-1',
          }),
        }),
      );
      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5' }),
      );
    });

    it('writes no usage row for a phase that measured nothing', async () => {
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: null,
        costUsd: '0',
      });

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        {
          phase: 'plan',
          model: 'claude-opus-5',
          totalCostUsd: 2,
          modelUsage: { 'claude-opus-5': { inputTokens: 0, outputTokens: 0 } },
        },
      );

      expect(llmUsage.record).not.toHaveBeenCalled();
    });

    it('replaces a re-reported phase instead of double counting it', async () => {
      // The end-of-workflow safety net re-posts every result file it finds, so
      // a phase whose first POST did land must not be counted twice.
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: { phases: { 'code-1': { model: 'coder', usd: 4 } } },
        costUsd: '4.0000',
      });
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '4.0000', budgetUsd: '25' }),
      );

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        { phase: 'code-1', model: 'coder', totalCostUsd: 4 },
      );

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-1' },
        expect.objectContaining({ costUsd: '4.0000' }),
      );
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it('warns once, not on every phase past the ceiling', async () => {
      runRepository.findOne.mockResolvedValue({
        id: 'run-1',
        sessionId: 'session-1',
        cost: { phases: { 'code-1': { model: 'coder', usd: 26 } } },
        costUsd: '26.0000',
      });
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '26.0000', budgetUsd: '25' }),
      );

      await service.recordRunCost(
        { id: 'run-1', sessionId: 'session-1' } as any,
        { phase: 'verify-1', model: 'verifier', totalCostUsd: 1 },
      );

      // Already over before this phase, so the crossing was announced then.
      expect(notificationService.budgetReached).not.toHaveBeenCalled();
    });
  });

  describe('hasPassingGate', () => {
    const gateEvent = (repo: string, kind: string, passed: boolean) => ({
      type: BuilderEventType.GATE_RESULT,
      payload: { repo, kind, passed },
    });

    it('is false when a run recorded no gate at all', async () => {
      // The case that mattered: testing used to be prompt-instructed, so a run
      // that never ran a suite could still self-report success.
      eventRepository.listByRun.mockResolvedValue([
        { type: BuilderEventType.TEXT, payload: { text: 'all tests pass!' } },
      ]);

      await expect(service.hasPassingGate('run-1')).resolves.toBe(false);
    });

    it('is true when every check the gate ran passed', async () => {
      eventRepository.listByRun.mockResolvedValue([
        gateEvent('ally-be', 'test', true),
        gateEvent('ally-be', 'lint', true),
      ]);

      await expect(service.hasPassingGate('run-1')).resolves.toBe(true);
    });

    it('is false when any check failed', async () => {
      eventRepository.listByRun.mockResolvedValue([
        gateEvent('ally-be', 'test', true),
        gateEvent('ally-be', 'lint', false),
      ]);

      await expect(service.hasPassingGate('run-1')).resolves.toBe(false);
    });

    it('reads the newest verdict per check, so a remediated failure counts as fixed', async () => {
      eventRepository.listByRun.mockResolvedValue([
        gateEvent('ally-be', 'test', false),
        gateEvent('ally-be', 'test', true),
      ]);

      await expect(service.hasPassingGate('run-1')).resolves.toBe(true);
    });
  });

  describe('getRunPhaseContext', () => {
    it('hands the remediation prompt the failures and objections to fix', async () => {
      eventRepository.listByRun.mockResolvedValue([
        {
          type: BuilderEventType.PLAN,
          payload: { text: '## Approach\nDo it.' },
        },
        {
          type: BuilderEventType.GATE_RESULT,
          payload: {
            repo: 'ally-be',
            kind: 'test',
            command: 'npm test',
            passed: false,
            newFailures: ['src/foo.spec.ts'],
            preExistingFailures: ['src/legacy.spec.ts'],
            outputTail: 'boom',
          },
        },
        {
          type: BuilderEventType.VERIFICATION,
          payload: {
            round: 1,
            verdict: 'fail',
            objections: [{ severity: 'blocking', summary: 'R2 has no test' }],
            notes: 'Otherwise clean.',
          },
        },
      ]);

      const context = await service.getRunPhaseContext('run-1');

      expect(context.planMd).toContain('## Approach');
      expect(context.gateFailures).toEqual([
        expect.objectContaining({
          repo: 'ally-be',
          kind: 'test',
          newFailures: ['src/foo.spec.ts'],
          preExistingFailures: ['src/legacy.spec.ts'],
        }),
      ]);
      expect(context.objections).toEqual([
        { severity: 'blocking', summary: 'R2 has no test' },
      ]);
      expect(context.verifierNotes).toBe('Otherwise clean.');
    });

    it('keeps only the newest verdict per check and round', async () => {
      // A remediation round re-runs both, and an older verdict describes code
      // that no longer exists — feeding it back would have the coder chasing
      // failures it already fixed.
      eventRepository.listByRun.mockResolvedValue([
        {
          type: BuilderEventType.GATE_RESULT,
          payload: {
            repo: 'ally-be',
            kind: 'test',
            passed: false,
            newFailures: ['old'],
          },
        },
        {
          type: BuilderEventType.GATE_RESULT,
          payload: { repo: 'ally-be', kind: 'test', passed: true },
        },
        {
          type: BuilderEventType.VERIFICATION,
          payload: { round: 1, objections: [{ summary: 'first' }] },
        },
        {
          type: BuilderEventType.VERIFICATION,
          payload: { round: 2, objections: [{ summary: 'second' }] },
        },
      ]);

      const context = await service.getRunPhaseContext('run-1');

      expect(context.gateFailures).toEqual([]);
      expect(context.objections).toEqual([{ summary: 'second' }]);
      expect(context.lastVerifyRound).toBe(2);
    });
  });

  describe('getBudgetState', () => {
    it('reports no ceiling when the session has none', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '3', budgetUsd: null }),
      );

      const state = await service.getBudgetState({
        id: 'run-1',
        sessionId: 'session-1',
      } as any);

      expect(state).toMatchObject({
        budgetUsd: null,
        spentUsd: 3,
        remainingUsd: null,
        exceeded: false,
      });
    });

    it('serves the hold window, so run-engine.sh need not hard-code it', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '25.5', budgetUsd: '25' }),
      );

      const state = await service.getBudgetState({
        id: 'run-1',
        sessionId: 'session-1',
      } as any);

      expect(state.holdSeconds).toBe(BUILDER_BUDGET_HOLD_SECONDS);
      expect(state.pollSeconds).toBe(BUILDER_BUDGET_HOLD_POLL_SECONDS);
    });

    it('flags a session that has spent its ceiling mid-run', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '25.5', budgetUsd: '25' }),
      );

      const state = await service.getBudgetState({
        id: 'run-1',
        sessionId: 'session-1',
      } as any);

      expect(state.exceeded).toBe(true);
      expect(state.remainingUsd).toBe(0);
    });
  });

  describe('raiseBudget', () => {
    const heldRun = {
      id: 'run-9',
      sessionId: 'session-1',
      status: BuilderRunStatus.RUNNING,
    };

    it('releases a run holding on the ceiling rather than making it retry', async () => {
      const session = readySession({
        status: BuilderSessionStatus.BUILDING,
        totalCostUsd: '16.77',
        budgetUsd: '15',
      });
      runRepository.findOne.mockResolvedValue(heldRun);
      eventRepository.latestOfType.mockResolvedValue({
        payload: { state: 'held', holdUntil: '2026-08-28T10:20:00.000Z' },
        createdAt: new Date('2026-08-28T10:00:00.000Z'),
      });
      // The raise itself is what the next poll reads, so the session has to
      // come back over the line before `released` can mean anything.
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '30' }),
      );

      const result = await service.raiseBudget(session as any, 7, 30);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { budgetUsd: '30', updatedBy: 7 },
      );
      expect(result.released).toBe(true);
      expect(result.exceeded).toBe(false);
      // On the run's own log, where the hold is — not just a banner that
      // quietly changes.
      expect(eventService.record).toHaveBeenCalledWith(
        heldRun,
        BuilderEventType.BUDGET_HOLD,
        expect.objectContaining({ state: 'raised', budgetUsd: 30 }),
      );
    });

    it('refuses a ceiling at or below what is already spent, which would stop it again at once', async () => {
      const session = readySession({
        status: BuilderSessionStatus.BUILDING,
        totalCostUsd: '16.77',
        budgetUsd: '15',
      });
      runRepository.findOne.mockResolvedValue(heldRun);

      await expect(service.raiseBudget(session as any, 7, 16)).rejects.toThrow(
        BadRequestException,
      );
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it('treats zero as removing the ceiling, not as a figure below the spend', async () => {
      const session = readySession({
        status: BuilderSessionStatus.BUILDING,
        totalCostUsd: '16.77',
        budgetUsd: '15',
      });
      runRepository.findOne.mockResolvedValue(heldRun);
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '0' }),
      );

      const result = await service.raiseBudget(session as any, 7, 0);

      expect(result.budgetUsd).toBeNull();
      expect(result.exceeded).toBe(false);
    });

    it('works with no run in flight — raising it between runs is the same action', async () => {
      const session = readySession({
        status: BuilderSessionStatus.FAILED,
        totalCostUsd: '16.77',
        budgetUsd: '15',
      });
      runRepository.findOne.mockResolvedValue(null);
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '40' }),
      );

      const result = await service.raiseBudget(session as any, 7, 40);

      expect(result.hold).toBeNull();
      expect(result.released).toBe(false);
      expect(eventService.record).not.toHaveBeenCalled();
    });
  });

  describe('recordBudgetHold', () => {
    it('marks the feed and tells the admin what the deadline is', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '15' }),
      );

      const result = await service.recordBudgetHold({
        id: 'run-9',
        sessionId: 'session-1',
      } as any);

      expect(result.holdSeconds).toBe(BUILDER_BUDGET_HOLD_SECONDS);
      expect(eventService.record).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-9' }),
        BuilderEventType.BUDGET_HOLD,
        expect.objectContaining({ state: 'held', spentUsd: 16.77 }),
      );
      expect(notificationService.budgetHold).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1' }),
        16.77,
        BUILDER_BUDGET_HOLD_SECONDS / 60,
      );
    });
  });

  describe('getSessionBudget', () => {
    it('reports the hold the page needs to offer a raise', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '15' }),
      );
      runRepository.findOne.mockResolvedValue({
        id: 'run-9',
        sessionId: 'session-1',
        status: BuilderRunStatus.RUNNING,
      });
      eventRepository.latestOfType.mockResolvedValue({
        payload: { state: 'held', holdUntil: '2026-08-28T10:20:00.000Z' },
        createdAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      const state = await service.getSessionBudget('session-1');

      expect(state.exceeded).toBe(true);
      expect(state.hold).toEqual({
        runId: 'run-9',
        heldAt: '2026-08-28T10:00:00.000Z',
        holdUntil: '2026-08-28T10:20:00.000Z',
      });
    });

    it('clears the hold when the ceiling moved without a raise event, e.g. a retry override', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '50' }),
      );
      runRepository.findOne.mockResolvedValue({
        id: 'run-9',
        sessionId: 'session-1',
        status: BuilderRunStatus.RUNNING,
      });
      // Still the last budget_hold event on the run — nothing wrote over it.
      eventRepository.latestOfType.mockResolvedValue({
        payload: { state: 'held', holdUntil: '2026-08-28T10:20:00.000Z' },
        createdAt: new Date('2026-08-28T10:00:00.000Z'),
      });

      const state = await service.getSessionBudget('session-1');

      expect(state.exceeded).toBe(false);
      expect(state.hold).toBeNull();
    });

    it('reports no hold once a raise has been recorded over it', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '30' }),
      );
      runRepository.findOne.mockResolvedValue({
        id: 'run-9',
        sessionId: 'session-1',
        status: BuilderRunStatus.RUNNING,
      });
      eventRepository.latestOfType.mockResolvedValue({
        payload: { state: 'raised', budgetUsd: 30 },
        createdAt: new Date('2026-08-28T10:05:00.000Z'),
      });

      const state = await service.getSessionBudget('session-1');

      expect(state.hold).toBeNull();
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

  /**
   * The fuse on automatic spend.
   *
   * The per-PR ceilings bound each loop separately — two reviews, three fixes —
   * and nothing watched the session as a whole. On 2026-09-16 one session burned
   * eight runs inside those ceilings while nothing succeeded after the build: a
   * review that died on a database error, a fix run sent at feedback that was
   * Builder's own approval, then more of both. Every ceiling was respected and
   * none of them noticed.
   */
  describe('pausing automatic runs after repeated failures', () => {
    const pr = {
      id: 'pr-1',
      sessionId: 'session-1',
      repo: 'ally-be',
      branch: 'builder/x',
      prNumber: 42,
      fixRunCount: 0,
    };

    const failed = (n: number) =>
      Array.from({ length: n }, () => ({ status: BuilderRunStatus.FAILED }));

    beforeEach(() => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        title: 'x',
        createdBy: 1,
      });
    });

    it('refuses a fix run once two in a row have failed', async () => {
      runRepository.listRecent.mockResolvedValue(failed(2));

      const run = await service.dispatchFixRun(pr as never);

      expect(run).toBeNull();
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      expect(notificationService.automationPaused).toHaveBeenCalled();
    });

    it('refuses a review run on the same evidence', async () => {
      runRepository.listRecent.mockResolvedValue(failed(2));

      expect(await service.dispatchReviewRun(pr as never, 'abc123')).toBeNull();
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('still dispatches after a single failure', async () => {
      runRepository.listRecent.mockResolvedValue(failed(1));

      await service.dispatchFixRun(pr as never);

      expect(github.dispatchWorkflow).toHaveBeenCalled();
      expect(notificationService.automationPaused).not.toHaveBeenCalled();
    });

    /** A loop that produced something is still doing work. */
    it('clears on any success in the recent history', async () => {
      runRepository.listRecent.mockResolvedValue([
        { status: BuilderRunStatus.FAILED },
        { status: BuilderRunStatus.SUCCEEDED },
        { status: BuilderRunStatus.FAILED },
      ]);

      await service.dispatchFixRun(pr as never);

      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });

    /**
     * A run still going is not a verdict — it must neither trip the breaker nor
     * reset it, or an in-flight retry would mask the failures behind it.
     */
    it('ignores a run that has not finished', async () => {
      runRepository.listRecent.mockResolvedValue([
        { status: BuilderRunStatus.RUNNING },
        { status: BuilderRunStatus.FAILED },
        { status: BuilderRunStatus.FAILED },
      ]);

      expect(await service.dispatchFixRun(pr as never)).toBeNull();
    });
  });
});
