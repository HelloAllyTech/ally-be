import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BuilderBuildService } from '../builder-build.service';
import {
  BuilderRunMode,
  BuilderRunStatus,
  BuilderSessionStatus,
} from '../../enum/builder.enum';
import { createDraftingDesign } from '../../util/builder-technical-design.util';

/**
 * A build is held to an approved technical design. Every test here that is
 * not about that gate gets one for free: a doc whose draft does not mention
 * `technicalDesign` at all comes back with an approved design drafted from
 * that same draft. A test about the gate sets it explicitly — `null` included.
 */
const withApprovedDesign = (doc: any) => {
  if (!doc?.draft || doc.draft.technicalDesign !== undefined) return doc;
  return {
    ...doc,
    draft: {
      ...doc.draft,
      technicalDesign: {
        ...createDraftingDesign(doc.draft, 'design-run'),
        status: 'approved',
      },
    },
  };
};

const readySession = (overrides: Record<string, any> = {}) => ({
  id: 'session-1',
  slug: 'add-a-thing',
  title: 'Add a thing',
  status: BuilderSessionStatus.PRD_READY,
  repos: ['ally-be'],
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
    createIssue: jest.Mock;
    addIssueLabels: jest.Mock;
    closeIssue: jest.Mock;
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
    listRecent: jest.Mock;
    countBlockingRuns: jest.Mock;
    findLatest: jest.Mock;
    isLatestForSession: jest.Mock;
  };
  let eventRepository: {
    listByRun: jest.Mock;
    latestOfType: jest.Mock;
  };
  let pullRequestRepository: {
    increment: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
  };
  let settingsService: { get: jest.Mock };
  let notificationService: {
    buildCompleted: jest.Mock;
    buildFailed: jest.Mock;
    budgetReached: jest.Mock;
    automationPaused: jest.Mock;
  };
  let eventService: { record: jest.Mock };
  let redisService: { acquireLock: jest.Mock; releaseLock: jest.Mock };
  let exemplarService: { archiveSession: jest.Mock };
  let epicService: {
    nextPending: jest.Mock;
    unbuiltRepoMilestone: jest.Mock;
    markStatus: jest.Mock;
    listBySession: jest.Mock;
    ensureRepoMilestones: jest.Mock;
  };
  let llmUsage: { record: jest.Mock };
  let llmModelsRepository: { find: jest.Mock };
  let prdService: {
    getOrCreateDoc: jest.Mock;
    setTechnicalDesign: jest.Mock;
    computeReadiness: jest.Mock;
  };

  beforeEach(() => {
    github = {
      isConfigured: true,
      dispatchWorkflow: jest.fn().mockResolvedValue(new Date()),
      findRunSince: jest.fn().mockResolvedValue(null),
      cancelRun: jest.fn().mockResolvedValue(undefined),
      getRun: jest.fn().mockResolvedValue(null),
      // A build is an issue in its repo; labelled on the first try unless a
      // test says otherwise.
      createIssue: jest.fn().mockResolvedValue({
        number: 41,
        htmlUrl: 'https://github.com/o/ally-be/issues/41',
        labels: ['builder'],
      }),
      addIssueLabels: jest.fn().mockResolvedValue(['builder']),
      closeIssue: jest.fn().mockResolvedValue(undefined),
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
      // Nothing in flight by default.
      countBlockingRuns: jest.fn().mockResolvedValue(0),
      findLatest: jest.fn().mockResolvedValue(null),
      isLatestForSession: jest.fn().mockResolvedValue(false),
    };
    eventRepository = {
      listByRun: jest.fn().mockResolvedValue([]),
      latestOfType: jest.fn().mockResolvedValue(null),
    };
    pullRequestRepository = {
      increment: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
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
      automationPaused: jest.fn(),
    };
    // Annotations the service writes onto a run's own log (an issue build's
    // milestones). Recorded through the event service so they also push over
    // the socket, which is why this is stubbed rather than the repository.
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
      unbuiltRepoMilestone: jest.fn().mockResolvedValue(null),
      markStatus: jest.fn(),
      listBySession: jest.fn().mockResolvedValue([]),
      ensureRepoMilestones: jest.fn().mockResolvedValue(undefined),
    };
    // Build-half spend goes to the unified usage store as well as the run row.
    llmUsage = { record: jest.fn().mockResolvedValue(undefined) };
    // The model catalog. Empty means "nothing is marked retired", which is
    // the state every other test in this file assumes.
    llmModelsRepository = { find: jest.fn().mockResolvedValue([]) };
    prdService = {
      getOrCreateDoc: jest
        .fn()
        .mockResolvedValue({ draft: { requirements: [], technicalPlan: '' } }),
      setTechnicalDesign: jest.fn().mockResolvedValue({}),
      computeReadiness: jest.fn().mockReturnValue({ ready: true }),
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
      llmModelsRepository as any,
      pullRequestRepository as any,
      settingsService as any,
      notificationService as any,
      eventService as any,
      redisService as any,
      exemplarService as any,
      epicService as any,
      llmUsage as any,
      {
        getOrCreateDoc: (...args: any[]) =>
          prdService.getOrCreateDoc(...args).then(withApprovedDesign),
        setTechnicalDesign: (...args: any[]) =>
          prdService.setTechnicalDesign(...args),
        computeReadiness: (...args: any[]) =>
          prdService.computeReadiness(...args),
      } as any,
      // Readiness with its signals; here only the draft's rubric matters.
      {
        assess: async (_sessionId: string, doc: any) =>
          prdService.computeReadiness(doc.draft),
      } as any,
    );
  });

  describe('issue dispatch', () => {
    it('raises an issue for a build, carrying no PRD or design', async () => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: {
          summary: 'A confidential product plan nobody outside may read.',
          requirements: [],
          technicalPlan: '',
        },
        versionNumber: 3,
      });

      const run = await service.startBuild(
        readySession({ repos: ['ally-be'] }) as any,
        1,
      );

      // A build never goes to Builder's own runner.
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      const [repo, issue] = github.createIssue.mock.calls[0];
      expect(repo).toBe('ally-be');
      expect(issue.labels).toEqual(['builder']);
      // ally-be is a public repo: the issue names the run, nothing more.
      expect(issue.body).toContain(`<!-- builder-run: ${run.id} -->`);
      expect(issue.body).not.toContain('confidential');
      expect(issue.title).not.toContain(readySession().title);
      expect(runRepository.update).toHaveBeenCalledWith(
        { id: run.id },
        expect.objectContaining({ issueNumber: 41, status: 'RUNNING' }),
      );
    });
  });

  describe('issue dispatch — what does not apply to it', () => {
    it("ignores Builder's model catalog, runner-minute ceiling and spend ceiling", async () => {
      // opencode uses the repo's BUILDER_MODEL on the repo's own Actions.
      llmModelsRepository.find.mockResolvedValue([
        { model: 'claude-sonnet-5', active: false },
      ]);
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        maxRunnerMinutes: 60,
      });

      await expect(
        service.startBuild(
          readySession({
            runnerMinutes: 500,
            budgetUsd: '10',
            totalCostUsd: '12',
          }) as any,
          1,
        ),
      ).resolves.toBeDefined();
      expect(github.createIssue).toHaveBeenCalled();
    });

    it('builds a one-repo design in the repo it names, whatever else the session lists', async () => {
      prdService.getOrCreateDoc.mockImplementation(async () => {
        const draft = { requirements: [], technicalPlan: '' } as any;
        draft.technicalDesign = {
          ...createDraftingDesign(draft, 'design-run'),
          status: 'approved',
          scope: [{ repo: 'ally-web', files: ['src/a.tsx'] }],
        };
        return { draft, versionNumber: 2 };
      });

      const run = await service.startBuild(
        readySession({ repos: ['ally-be', 'ally-web'] }) as any,
        1,
      );

      expect(github.createIssue.mock.calls[0][0]).toBe('ally-web');
      expect(run.repos).toEqual(['ally-web']);
    });
  });

  describe('issue dispatch — the label', () => {
    beforeEach(() => {
      github.createIssue.mockResolvedValue({
        number: 41,
        htmlUrl: 'https://github.com/o/ally-be/issues/41',
        // What GitHub returns when the token may open issues but not label them.
        labels: [],
      });
    });

    it('adds the label GitHub dropped', async () => {
      await service.startBuild(readySession({ repos: ['ally-be'] }) as any, 1);

      expect(github.addIssueLabels).toHaveBeenCalledWith('ally-be', 41, [
        'builder',
      ]);
      expect(runRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ issueNumber: 41, status: 'RUNNING' }),
      );
    });

    it('fails the build, naming the permission, when the label cannot be added', async () => {
      github.addIssueLabels.mockResolvedValue([]);

      await expect(
        service.startBuild(readySession({ repos: ['ally-be'] }) as any, 1),
      ).rejects.toThrow(
        /could not label it `builder`.*permission to label issues/,
      );
    });
  });

  describe('a one-repo-per-build chain that stops before its last repo', () => {
    it('fails the session with the reason, rather than calling it complete', async () => {
      const run = {
        id: 'run-11',
        sessionId: 'session-1',
        mode: BuilderRunMode.BUILD,
        milestoneId: 'm2',
        startedAt: new Date(),
        dispatchedAt: new Date(),
      };
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        status: BuilderSessionStatus.BUILDING,
        repos: ['ally-be', 'ally-web', 'ally-mobile'],
      });
      runRepository.isLatestForSession.mockResolvedValue(true);
      epicService.nextPending.mockResolvedValue({
        id: 'm3',
        position: 3,
        title: 'ally-mobile',
        repos: ['ally-mobile'],
        branchSlug: 'rich-text',
      });
      github.createIssue.mockRejectedValue(
        new Error('Request failed with status code 403'),
      );

      await service.settleRun(run as any, BuilderRunStatus.SUCCEEDED, null);

      expect(epicService.markStatus).toHaveBeenCalledWith(
        'm3',
        'PENDING',
        expect.stringMatching(/403/),
      );
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({
          status: BuilderSessionStatus.FAILED,
          error: expect.stringMatching(/Could not start ally-mobile: .*403/),
        }),
      );
      expect(sessionRepository.update).not.toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.COMPLETED }),
      );
    });

    it('lets a session marked complete restart while a repo is still to build', async () => {
      const mobile = {
        id: 'm3',
        position: 3,
        title: 'ally-mobile',
        repos: ['ally-mobile'],
        branchSlug: 'rich-text',
      };
      epicService.unbuiltRepoMilestone.mockResolvedValue(mobile);
      epicService.nextPending.mockResolvedValue(mobile);
      pullRequestRepository.count = jest.fn().mockResolvedValue(2);

      const run = await service.startBuild(
        readySession({ status: BuilderSessionStatus.COMPLETED }) as any,
        1,
      );

      expect(run).toEqual(
        expect.objectContaining({ milestoneId: 'm3', repos: ['ally-mobile'] }),
      );
    });
  });

  describe('a start whose dispatch fails', () => {
    const mobile = {
      id: 'm3',
      position: 3,
      title: 'ally-mobile',
      repos: ['ally-mobile'],
      branchSlug: 'rich-text',
    };

    it('puts the milestone back to build rather than leaving it BUILDING', async () => {
      epicService.nextPending.mockResolvedValue(mobile);
      github.createIssue.mockRejectedValue(
        new Error('Request failed with status code 403'),
      );

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/403/);

      expect(epicService.markStatus).toHaveBeenCalledWith('m3', 'BUILDING');
      expect(epicService.markStatus).toHaveBeenLastCalledWith(
        'm3',
        'PENDING',
        expect.stringMatching(/403/),
      );
    });

    it('can be restarted when an earlier failed start left the milestone BUILDING', async () => {
      // 10-14: the session read COMPLETED, ally-mobile read BUILDING, nothing ran.
      epicService.unbuiltRepoMilestone.mockResolvedValue({
        ...mobile,
        status: 'BUILDING',
      });
      // ensureRepoMilestones puts it back to PENDING before the lookup.
      epicService.nextPending.mockResolvedValue(mobile);
      pullRequestRepository.count = jest.fn().mockResolvedValue(2);

      await expect(
        service.startBuild(
          readySession({ status: BuilderSessionStatus.COMPLETED }) as any,
          1,
        ),
      ).resolves.toEqual(expect.objectContaining({ milestoneId: 'm3' }));
      expect(epicService.ensureRepoMilestones).toHaveBeenCalled();
    });

    it('refuses while a run for the session is still in flight', async () => {
      epicService.unbuiltRepoMilestone.mockResolvedValue({
        ...mobile,
        status: 'BUILDING',
      });
      pullRequestRepository.count = jest.fn().mockResolvedValue(2);
      runRepository.count.mockResolvedValue(1);

      await expect(
        service.startBuild(
          readySession({ status: BuilderSessionStatus.COMPLETED }) as any,
          1,
        ),
      ).rejects.toThrow(/can only start from a ready PRD/);
    });
  });

  describe('one repo per build', () => {
    it('raises the first repo milestone in its repo only, and keeps the model for the chain', async () => {
      epicService.nextPending.mockResolvedValue({
        id: 'm1',
        position: 1,
        repos: ['ally-be'],
        branchSlug: 'rich-text',
      });

      const run = await service.startBuild(
        readySession({ repos: ['ally-be', 'ally-web'] }) as any,
        1,
        { model: 'gemini-3-flash-preview' },
      );

      expect(epicService.ensureRepoMilestones).toHaveBeenCalled();
      expect(epicService.markStatus).toHaveBeenCalledWith('m1', 'BUILDING');
      expect(github.createIssue.mock.calls[0][0]).toBe('ally-be');
      expect(run).toEqual(
        expect.objectContaining({
          repos: ['ally-be'],
          milestoneId: 'm1',
          branchSlug: 'rich-text',
        }),
      );
      // advanceEpic has no request to read overrides from; the session does.
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({
          metadata: expect.objectContaining({
            buildOverrides: { model: 'gemini-3-flash-preview' },
          }),
        }),
      );
    });
  });

  /**
   * The size is recorded with every run, frozen at dispatch: the PRD keeps
   * changing, and the metrics read outcomes per size.
   */
  describe('sizing a build', () => {
    it('records the size and effort the PRD was classified as', async () => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: {
          requirements: [{ id: 'R1' }, { id: 'R2' }],
          technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'small' }] },
        },
      });

      await service.startBuild(readySession() as any, 1);

      expect(runRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          size: 'small',
          effort: 'low',
          requirementCount: 2,
        }),
      );
    });

    it('sizes at the default when the PRD cannot be read', async () => {
      // The design gate reads it first and finds an approved design; the
      // sizing read after it is the one that fails.
      prdService.getOrCreateDoc
        .mockResolvedValueOnce({ draft: { requirements: [] } })
        .mockRejectedValue(new Error('gone'));

      await service.startBuild(readySession() as any, 1);

      // An unreadable PRD is a reason to record the default, not to refuse.
      expect(runRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ size: 'medium' }),
      );
      expect(github.createIssue).toHaveBeenCalled();
    });
  });

  /**
   * A design run refused before it costs anything, rather than one that
   * runs on a model that no longer answers. (A build runs on its repo's own
   * opencode model, so the catalog is not consulted for it.)
   */
  describe('model preflight', () => {
    it('refuses a design run whose coder tier is marked retired', async () => {
      llmModelsRepository.find.mockResolvedValue([
        { model: 'claude-sonnet-5', active: false },
      ]);

      await expect(
        service.startDesign(readySession() as any, 1),
      ).rejects.toThrow(/retired/i);
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('names the model, so the admin knows which tier to change', async () => {
      llmModelsRepository.find.mockResolvedValue([
        { model: 'claude-opus-5', active: false },
      ]);

      await expect(
        service.startDesign(readySession() as any, 1),
      ).rejects.toThrow(/claude-opus-5/);
    });

    /**
     * The catalog is admin-maintained and lags reality in both directions.
     * Refusing a run because nobody has added a row yet would be a worse
     * failure than the one this prevents, so only an explicit retirement
     * blocks.
     */
    it('allows a model the catalog has never heard of', async () => {
      llmModelsRepository.find.mockResolvedValue([]);

      await service.startDesign(readySession() as any, 1);

      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });

    it('dispatches the design run from master by default', async () => {
      await service.startDesign(readySession() as any, 1);

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'master' }),
      );
    });

    it('dispatches from the configured ref, to prove a runner change on dev', async () => {
      (service as any).configService.builder.designWorkflowRef =
        'builder/design-only-engine';

      await service.startDesign(readySession() as any, 1);

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'builder/design-only-engine' }),
      );
    });

    it('allows the run when the catalog itself cannot be read', async () => {
      llmModelsRepository.find.mockRejectedValue(new Error('db down'));

      await service.startDesign(readySession() as any, 1);

      // A database hiccup is not evidence a model is gone.
      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });

    it('checks the planner and verifier, not just the coder', async () => {
      llmModelsRepository.find.mockResolvedValue([]);

      await service.startDesign(readySession() as any, 1);

      const asked = llmModelsRepository.find.mock.calls[0][0].where.model;
      const wanted = (asked as { _value: string[] })._value ?? asked;
      expect(wanted).toEqual(expect.arrayContaining(['claude-opus-5']));
    });
  });

  describe('startBuild', () => {
    it('raises the issue with the run id, so its workflow can fetch the spec', async () => {
      const run = await service.startBuild(readySession() as any, 1);

      expect(run.id).toBe('run-1');
      // The row must exist BEFORE the issue: the issue names the run, and its
      // workflow fetches the spec with that id.
      const saveOrder = runRepository.save.mock.invocationCallOrder[0];
      const issueOrder = github.createIssue.mock.invocationCallOrder[0];
      expect(saveOrder).toBeLessThan(issueOrder);

      expect(github.createIssue).toHaveBeenCalledWith(
        'ally-be',
        expect.objectContaining({
          body: expect.stringContaining('<!-- builder-run: run-1 -->'),
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
      expect(github.createIssue).not.toHaveBeenCalled();
    });

    it('refuses when GitHub is not configured', async () => {
      github.isConfigured = false;

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('refuses at the concurrency ceiling', async () => {
      // Counted on runs in flight, not sessions: one session can hold
      // several runs.
      runRepository.count.mockResolvedValue(3);

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/already running/i);
    });

    it('refuses from a PRD that is not ready', async () => {
      await expect(
        service.startBuild(
          readySession({ status: BuilderSessionStatus.INTERVIEWING }) as any,
          1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('fails the run and the session when the issue cannot be raised', async () => {
      github.createIssue.mockRejectedValue(new Error('GitHub is down'));

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

  describe('branch for a new build', () => {
    // A previous build/resume run on this session, as branchSlugForBuild
    // looks it up; every other findOne keeps the default.
    const previousRun = (run: Record<string, unknown> | null) =>
      runRepository.findOne.mockImplementation(async (query: any) =>
        query?.where?.mode ? run : undefined,
      );
    const dispatchedSlug = () =>
      runRepository.create.mock.calls[0][0].branchSlug;

    beforeEach(() => {
      prdService.getOrCreateDoc.mockResolvedValue({
        draft: { requirements: [], technicalPlan: '' },
        versionNumber: 4,
      });
    });

    it('uses the session slug for the first build, and records the PRD version', async () => {
      previousRun(null);

      await service.startBuild(readySession() as any, 1);

      expect(dispatchedSlug()).toBe(readySession().slug);
      expect(runRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ prdVersion: 4 }),
      );
    });

    it('resumes the previous branch when the PRD has not changed', async () => {
      previousRun({ branchSlug: 'add-a-thing', prdVersion: 4 });

      await service.startBuild(readySession() as any, 1);

      expect(dispatchedSlug()).toBe('add-a-thing');
    });

    /**
     * Session 880e73e6, 2026-10-12: stopped because its PRD prescribed a
     * breaking rename, PRD rewritten, rebuilt — and the rebuild gated and
     * remediated the old rename instead of coding the new PRD.
     */
    it('starts its own branch when the PRD changed since the last run', async () => {
      previousRun({ branchSlug: 'add-a-thing', prdVersion: 3 });

      await service.startBuild(readySession() as any, 1);

      expect(dispatchedSlug()).toBe(`${readySession().slug}-v4`);
    });

    it('keeps the previous branch while it has an open pull request', async () => {
      previousRun({ branchSlug: 'add-a-thing', prdVersion: 3 });
      pullRequestRepository.count.mockResolvedValue(1);

      await service.startBuild(readySession() as any, 1);

      expect(dispatchedSlug()).toBe('add-a-thing');
    });

    it('keeps resuming runs dispatched before versions were recorded', async () => {
      previousRun({ branchSlug: 'add-a-thing', prdVersion: null });

      await service.startBuild(readySession() as any, 1);

      expect(dispatchedSlug()).toBe('add-a-thing');
    });
  });

  describe('engine', () => {
    it('records opencode on the run and sends no engine input to a design run', async () => {
      await service.startDesign(readySession() as any, 1);

      expect(runRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ engine: 'opencode' }),
      );
      expect(
        github.dispatchWorkflow.mock.calls[0][0].inputs,
      ).not.toHaveProperty('engine');
    });
  });

  /**
   * Stopping a build used to be a one-way door: the session kept its PRD and
   * its branch, and the API refused every attempt to build from it again.
   */
  describe('which states a build can start from', () => {
    const startFrom = (status: BuilderSessionStatus) =>
      service.startBuild(readySession({ status }) as any, 1);

    it('starts again after a stop', async () => {
      await expect(
        startFrom(BuilderSessionStatus.CANCELLED),
      ).resolves.toBeDefined();
    });

    it('starts again after a failure', async () => {
      await expect(
        startFrom(BuilderSessionStatus.FAILED),
      ).resolves.toBeDefined();
    });

    /**
     * Finished work stays finished. Its pull requests are open or merged, and
     * a second build against the same PRD opens a competing set.
     */
    it('refuses to rebuild finished work', async () => {
      pullRequestRepository.count.mockResolvedValue(2);

      await expect(startFrom(BuilderSessionStatus.COMPLETED)).rejects.toThrow(
        /can only start from a ready PRD/,
      );
    });

    /**
     * "A session with no pull requests has shipped nothing, whatever its
     * status" — getDeliveryState's own words. A run that claimed done and left
     * an empty branch settles the session green, and that must not be a dead
     * end.
     */
    it('rebuilds a completed session that shipped nothing', async () => {
      pullRequestRepository.count.mockResolvedValue(0);

      await expect(
        startFrom(BuilderSessionStatus.COMPLETED),
      ).resolves.toBeDefined();
    });

    it('refuses while a build is already running', async () => {
      await expect(startFrom(BuilderSessionStatus.BUILDING)).rejects.toThrow(
        /can only start from a ready PRD/,
      );
    });
  });

  /**
   * A run reports its outcome once — but the runner reports one too, from
   * evidence, after the agent has finished. When the agent claims done and the
   * runner then finds no pull request, the second report is the true one.
   */
  describe('evidence correcting a success the agent claimed', () => {
    const settling = (sessionStatus: BuilderSessionStatus, latest = true) => {
      const run = {
        id: 'run-1',
        sessionId: 'session-1',
        startedAt: new Date(),
        dispatchedAt: new Date(),
      };
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        status: sessionStatus,
      });
      runRepository.isLatestForSession.mockResolvedValue(latest);
      return run;
    };

    /**
     * The stranding this repo has now seen twice.
     *
     * `reviewedSha` is stamped before a review is dispatched, so reconcile
     * cannot send two reviewers at one pull request. But the stamp means "a
     * review was attempted here" and the guard reads it as "this commit has
     * been reviewed" — identical for a run that finished, not for one that
     * failed. A single failure therefore left the pull request unreviewable
     * for good: its head never moves on its own, so no second review is ever
     * dispatched, `reviewPassedSha` is never written, and approval and
     * auto-merge wait on evidence that can no longer arrive.
     */
    describe('a review run that failed', () => {
      const reviewRun = (status: BuilderRunStatus) => {
        const run = {
          id: 'run-9',
          sessionId: 'session-1',
          mode: BuilderRunMode.REVIEW,
          pullRequestId: 'pr-1',
          startedAt: new Date(),
          dispatchedAt: new Date(),
        };
        sessionRepository.findOne.mockResolvedValue({
          id: 'session-1',
          status: BuilderSessionStatus.BUILDING,
        });
        runRepository.isLatestForSession.mockResolvedValue(true);
        return service.settleRun(run as any, status, 'boom');
      };

      it('hands the pull request back so the next tick can retry', async () => {
        await reviewRun(BuilderRunStatus.FAILED);

        expect(pullRequestRepository.update).toHaveBeenCalledWith(
          { id: 'pr-1' },
          { reviewedSha: null },
        );
      });

      it('does the same when it timed out or was stopped', async () => {
        await reviewRun(BuilderRunStatus.TIMED_OUT);
        await reviewRun(BuilderRunStatus.CANCELLED);

        expect(pullRequestRepository.update).toHaveBeenCalledTimes(2);
      });

      /**
       * `reviewRunCount` is what bounds the retry. Rolling it back too would
       * turn a failing engine into an endless supply of review runs; leaving
       * it means a pull request still gets at most the cap, and clearing the
       * sha buys a retry rather than a loop.
       */
      it('does not refund the attempt', async () => {
        await reviewRun(BuilderRunStatus.FAILED);

        expect(pullRequestRepository.increment).not.toHaveBeenCalled();
      });

      /** A review that SUCCEEDED has genuinely reviewed that commit. */
      it('leaves the claim alone when the review finished', async () => {
        await reviewRun(BuilderRunStatus.SUCCEEDED);

        expect(pullRequestRepository.update).not.toHaveBeenCalled();
      });
    });

    it('takes a session back off COMPLETED when its own run then fails', async () => {
      const run = settling(BuilderSessionStatus.COMPLETED);

      await service.settleRun(
        run as any,
        BuilderRunStatus.FAILED,
        'Work was pushed but no pull request exists.',
      );

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.FAILED }),
      );
    });

    /**
     * The guard this narrows still has to hold: a human pressing stop is not
     * overruled by a run finishing a moment later.
     */
    it('leaves a session a person cancelled alone', async () => {
      const run = settling(BuilderSessionStatus.CANCELLED);

      await service.settleRun(run as any, BuilderRunStatus.FAILED, 'boom');

      expect(sessionRepository.update).not.toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.FAILED }),
      );
    });

    it('does not let a stale run reopen a session that has moved on', async () => {
      const run = settling(BuilderSessionStatus.COMPLETED, false);

      await service.settleRun(run as any, BuilderRunStatus.FAILED, 'boom');

      expect(sessionRepository.update).not.toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.FAILED }),
      );
    });

    /**
     * One direction only. Evidence may correct a claim; a claim may not
     * overwrite evidence.
     */
    it('never turns a failed session green', async () => {
      const run = settling(BuilderSessionStatus.FAILED);

      await service.settleRun(run as any, BuilderRunStatus.SUCCEEDED, null);

      expect(sessionRepository.update).not.toHaveBeenCalledWith(
        { id: 'session-1' },
        expect.objectContaining({ status: BuilderSessionStatus.COMPLETED }),
      );
    });
  });

  describe('spend and concurrency guards', () => {
    it('refuses a dispatch while another is already starting for the session', async () => {
      // A double-click used to send two runs at the same branches.
      redisService.acquireLock.mockResolvedValue(false);

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/already being started/i);
      expect(github.createIssue).not.toHaveBeenCalled();
    });

    it('releases the dispatch lock even when the dispatch throws', async () => {
      github.createIssue.mockRejectedValue(new Error('GitHub is down'));

      await expect(
        service.startBuild(readySession() as any, 1),
      ).rejects.toThrow(/GitHub is down/);
      // Held to its TTL instead, this would refuse the retry for a minute.
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('refuses a design run once the session has spent its budget', async () => {
      await expect(
        service.startDesign(
          readySession({ budgetUsd: '10', totalCostUsd: '10.5' }) as any,
          1,
        ),
      ).rejects.toThrow(/budget/i);
    });

    it('refuses a design run once the session has used its runner minutes', async () => {
      // A separate ceiling from dollars on purpose: a run can be cheap in
      // tokens and still hold a runner for two hours.
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        maxRunnerMinutes: 600,
      });

      await expect(
        service.startDesign(readySession({ runnerMinutes: 640 }) as any, 1),
      ).rejects.toThrow(/runner minutes/i);
    });

    it('allows a design run when minutes are under the ceiling', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        maxConcurrentBuilds: 3,
        maxRunnerMinutes: 600,
      });

      await expect(
        service.startDesign(readySession({ runnerMinutes: 120 }) as any, 1),
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

  describe('in-repo review of an opencode pull request', () => {
    const ocPr = {
      id: 'pr-114',
      sessionId: 'session-1',
      repo: 'ally-mobile',
      branch: 'opencode/issue113-20261014085905',
      prNumber: 114,
      runId: 'build-run-15',
    };
    const reviewRun = (overrides: Record<string, any> = {}) => ({
      id: 'review-1',
      sessionId: 'session-1',
      mode: BuilderRunMode.REVIEW,
      status: BuilderRunStatus.RUNNING,
      repos: ['ally-mobile'],
      pullRequestId: 'pr-114',
      dispatchedAt: new Date(Date.now() - 10 * 60_000),
      cost: { reviewWorkflow: 'repo', reviewedSha: 'abc1234' },
      ...overrides,
    });

    it("starts builder-review.yml in the PR's own repo, not ally-be's runner", async () => {
      const run = await service.dispatchReviewRun(ocPr as never, 'abc1234def');

      expect(github.dispatchWorkflow).toHaveBeenCalledTimes(1);
      expect(github.dispatchWorkflow).toHaveBeenCalledWith({
        repo: 'ally-mobile',
        workflow: 'builder-review.yml',
        ref: 'master',
        inputs: {
          pr_number: '114',
          spec_run_id: 'build-run-15',
          review_run_id: run!.id,
          builder_pr_id: 'pr-114',
        },
      });
      expect(runRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: BuilderRunMode.REVIEW,
          repos: ['ally-mobile'],
          pullRequestId: 'pr-114',
          cost: expect.objectContaining({ reviewWorkflow: 'repo' }),
        }),
      );
      expect(runRepository.update).toHaveBeenCalledWith(
        { id: run!.id },
        expect.objectContaining({ status: BuilderRunStatus.RUNNING }),
      );
      expect(pullRequestRepository.update).toHaveBeenCalledWith(
        { id: 'pr-114' },
        { reviewedSha: 'abc1234def' },
      );
    });

    it('settles only the run and its review claim, never the session', async () => {
      await service.settleRepoReview(
        reviewRun() as any,
        BuilderRunStatus.FAILED,
        'boom',
      );

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'review-1' },
        expect.objectContaining({ status: BuilderRunStatus.FAILED }),
      );
      // The claim is released so the next tick can review this head again.
      expect(pullRequestRepository.update).toHaveBeenCalledWith(
        { id: 'pr-114' },
        { reviewedSha: null },
      );
      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it('fails a review whose workflow ended without filing a verdict', async () => {
      runRepository.listActive.mockResolvedValue([reviewRun()]);
      runRepository.findOne.mockResolvedValue(reviewRun());
      github.findRunSince.mockResolvedValue({
        id: '77',
        status: 'completed',
        conclusion: 'failure',
        htmlUrl: 'https://github.com/o/ally-mobile/actions/runs/77',
      });

      await service.reconcile();

      expect(github.findRunSince).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'ally-mobile',
          workflow: 'builder-review.yml',
        }),
      );
      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'review-1' },
        expect.objectContaining({
          status: BuilderRunStatus.FAILED,
          error: expect.stringMatching(/without filing a verdict/),
        }),
      );
      expect(github.getRun).not.toHaveBeenCalled();
    });

    it('cancels the review where it runs', async () => {
      github.findRunSince.mockResolvedValue({
        id: '78',
        status: 'in_progress',
      });

      await service.cancelRun(reviewRun({ githubRunId: null }) as any, 7);

      expect(github.cancelRun).toHaveBeenCalledWith('ally-mobile', '78');
      expect(github.cancelRun).not.toHaveBeenCalledWith(
        'ally-be',
        expect.anything(),
      );
    });
  });

  describe('issue builds — bookkeeping', () => {
    it('does not count an issue build against the runner-minute ceiling', async () => {
      sessionRepository.findOne.mockResolvedValue(readySession());
      const run = {
        id: 'run-15',
        sessionId: 'session-1',
        mode: BuilderRunMode.BUILD,
        issueNumber: 113,
        dispatchedAt: new Date(Date.now() - 40 * 60_000),
        startedAt: new Date(Date.now() - 40 * 60_000),
      };

      await service.settleRun(run as any, BuilderRunStatus.SUCCEEDED, null);

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-15' },
        expect.objectContaining({ runnerMinutes: null }),
      );
      expect(sessionRepository.increment).not.toHaveBeenCalledWith(
        expect.anything(),
        'runnerMinutes',
        expect.anything(),
      );
    });

    it('keeps the Actions log link and records the CI verdict as its own event', async () => {
      const run = { id: 'run-15', sessionId: 'session-1', cost: null };
      runRepository.findOne.mockResolvedValue(run);
      const ci = {
        repo: 'ally-mobile',
        prNumber: 114,
        prUrl: 'https://github.com/o/ally-mobile/pull/114',
        sha: 'abc',
        state: 'failure' as const,
        failed: ['Jest'],
      };

      await service.recordIssueMilestone(
        run as any,
        'working:9',
        'opencode is working',
        undefined,
        { workflowRunUrl: 'https://github.com/o/ally-mobile/actions/runs/9' },
      );
      await service.recordIssueMilestone(
        run as any,
        'ci-fail:abc',
        'CI failed',
        undefined,
        { ci },
      );

      expect(runRepository.update).toHaveBeenCalledWith(
        { id: 'run-15' },
        {
          cost: expect.objectContaining({
            issueWorkflowRunUrl:
              'https://github.com/o/ally-mobile/actions/runs/9',
          }),
        },
      );
      expect(eventService.record).toHaveBeenCalledWith(
        run,
        'ci_result',
        ci,
        null,
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

    it('looks the run up inline when it was never correlated', async () => {
      github.findRunSince.mockResolvedValue({ id: '123' });

      await service.cancelRun({ ...run, githubRunId: null } as any, 7);

      expect(github.cancelRun).toHaveBeenCalledWith('ally-be', '123');
    });

    it("stops an issue build in its own repo, and never touches ally-be's runner", async () => {
      // Looking for ally-be's runner here found another session's review run.
      (github as any).closeIssue = jest.fn().mockResolvedValue(undefined);
      github.findRunSince.mockResolvedValue({
        id: '555',
        status: 'in_progress',
      });

      await service.cancelRun(
        {
          ...run,
          githubRunId: null,
          issueNumber: 113,
          repos: ['ally-mobile'],
        } as any,
        7,
      );

      expect(github.findRunSince).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'ally-mobile',
          workflow: 'builder.yml',
          event: 'issues',
        }),
      );
      expect(github.cancelRun).toHaveBeenCalledWith('ally-mobile', '555');
      expect(github.cancelRun).not.toHaveBeenCalledWith(
        'ally-be',
        expect.anything(),
      );
      expect((github as any).closeIssue).toHaveBeenCalledWith(
        'ally-mobile',
        113,
      );
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

    it('files each model under its own provider, not the engine', async () => {
      // opencode (the default engine) runs Gemini; these rows used to be
      // hardcoded 'anthropic', so Gemini spend read as Claude spend.
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
          model: 'gemini-2.5-pro',
          totalCostUsd: 1,
          modelUsage: {
            'gemini-2.5-pro': { inputTokens: 1000, outputTokens: 10 },
            'claude-haiku-4-5': { inputTokens: 500, outputTokens: 5 },
          },
        },
      );

      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.5-pro',
          provider: 'gemini',
        }),
      );
      expect(llmUsage.record).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5',
          provider: 'anthropic',
        }),
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

  describe('getSessionBudget', () => {
    it('reports no ceiling when the session has none', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '3', budgetUsd: null }),
      );

      const state = await service.getSessionBudget('session-1');

      expect(state).toEqual({
        budgetUsd: null,
        spentUsd: 3,
        remainingUsd: null,
        exceeded: false,
      });
    });

    it('flags a session that has spent its ceiling', async () => {
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '25.5', budgetUsd: '25' }),
      );

      const state = await service.getSessionBudget('session-1');

      expect(state.exceeded).toBe(true);
      expect(state.remainingUsd).toBe(0);
    });
  });

  describe('raiseBudget', () => {
    it('raises the ceiling and answers with the state it leaves', async () => {
      const session = readySession({
        status: BuilderSessionStatus.BUILDING,
        totalCostUsd: '16.77',
        budgetUsd: '15',
      });
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '30' }),
      );

      const result = await service.raiseBudget(session as any, 7, 30);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 'session-1' },
        { budgetUsd: '30', updatedBy: 7 },
      );
      expect(result.exceeded).toBe(false);
      expect(result.budgetUsd).toBe(30);
    });

    it('refuses a ceiling at or below what is already spent, which would stop it again at once', async () => {
      const session = readySession({
        status: BuilderSessionStatus.BUILDING,
        totalCostUsd: '16.77',
        budgetUsd: '15',
      });

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
      sessionRepository.findOne.mockResolvedValue(
        readySession({ totalCostUsd: '16.77', budgetUsd: '0' }),
      );

      const result = await service.raiseBudget(session as any, 7, 0);

      expect(result.budgetUsd).toBeNull();
      expect(result.exceeded).toBe(false);
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
   * none of them noticed. Reviews are the automatic runs left.
   */
  describe('pausing automatic runs after repeated failures', () => {
    const pr = {
      id: 'pr-1',
      sessionId: 'session-1',
      repo: 'ally-be',
      branch: 'opencode/issue41',
      prNumber: 42,
      runId: 'build-run-1',
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

    it('refuses a review run once two in a row have failed', async () => {
      runRepository.listRecent.mockResolvedValue(failed(2));

      expect(await service.dispatchReviewRun(pr as never, 'abc123')).toBeNull();
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      expect(notificationService.automationPaused).toHaveBeenCalled();
    });

    it('still dispatches after a single failure', async () => {
      runRepository.listRecent.mockResolvedValue(failed(1));

      await service.dispatchReviewRun(pr as never, 'abc123');

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

      await service.dispatchReviewRun(pr as never, 'abc123');

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

      expect(await service.dispatchReviewRun(pr as never, 'abc123')).toBeNull();
    });
  });

  /**
   * The technical design stage. Session 880e73e6 shipped a plan that renamed
   * a persisted JSON key with a migration, written by an interviewer with no
   * checkout; a build is now held to a design written with the code in front
   * of it and approved by a person.
   */
  describe('technical design', () => {
    /** A ready PRD with a design in the given state, drafted from itself. */
    const designedDoc = (design: Record<string, any> | null) => {
      const draft: any = {
        requirements: [{ id: 'R1' }],
        technicalPlan: { repos: [{ repo: 'ally-be', changesMd: 'x' }] },
      };
      return {
        id: 'doc-1',
        draft: {
          ...draft,
          technicalDesign: design && {
            ...createDraftingDesign(draft, 'design-run'),
            ...design,
          },
        },
      };
    };
    const reviewable = {
      status: 'review',
      designMd: 'Add an optional key beside the old one. '.repeat(10),
      scope: [
        {
          repo: 'ally-web',
          files: ['src/pages/Quiz.tsx', 'src/pages/Quiz.test.tsx'],
        },
      ],
      contracts: [],
      compatibilityMd: '',
      testMap: [
        {
          requirementId: 'R1',
          repo: 'ally-web',
          file: 'src/pages/Quiz.test.tsx',
          asserts: 'renders it',
        },
      ],
      openDecisions: [],
    };

    describe('startBuild requires an approved, current design', () => {
      it('refuses with no design', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(designedDoc(null));

        await expect(
          service.startBuild(readySession() as any, 1),
        ).rejects.toThrow(/Approve the technical design before building/);
        expect(github.createIssue).not.toHaveBeenCalled();
        expect(sessionRepository.update).not.toHaveBeenCalled();
      });

      it('refuses a design still in review', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(designedDoc(reviewable));

        await expect(
          service.startBuild(readySession() as any, 1),
        ).rejects.toThrow(/Approve the technical design before building/);
      });

      it('refuses an approved design the PRD has moved on from', async () => {
        const doc = designedDoc({ ...reviewable, status: 'approved' });
        doc.draft.requirements.push({ id: 'R2' });
        prdService.getOrCreateDoc.mockResolvedValue(doc);

        await expect(
          service.startBuild(readySession() as any, 1),
        ).rejects.toThrow(
          /PRD changed after the technical design was approved/,
        );
        expect(github.createIssue).not.toHaveBeenCalled();
      });

      it('builds from an approved, current design', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(
          designedDoc({ ...reviewable, status: 'approved' }),
        );

        await service.startBuild(readySession() as any, 1);

        expect(github.createIssue).toHaveBeenCalled();
      });
    });

    describe('startDesign', () => {
      beforeEach(() => {
        prdService.getOrCreateDoc.mockResolvedValue(designedDoc(null));
      });

      it('refuses a PRD that is not ready', async () => {
        prdService.computeReadiness.mockReturnValue({ ready: false });

        await expect(
          service.startDesign(readySession() as any, 1),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      });

      it('refuses while the session has a run in flight', async () => {
        runRepository.countBlockingRuns.mockResolvedValue(1);

        await expect(
          service.startDesign(readySession() as any, 1),
        ).rejects.toThrow(/already has a run in flight/);
      });

      it('dispatches a design run and names it on a fresh drafting design', async () => {
        const run = await service.startDesign(readySession() as any, 7);

        expect(run.mode).toBe(BuilderRunMode.DESIGN);
        expect(github.dispatchWorkflow.mock.calls[0][0].inputs.mode).toBe(
          'design',
        );
        const [, design] = prdService.setTechnicalDesign.mock.calls[0];
        expect(design).toEqual(
          expect.objectContaining({
            status: 'drafting',
            runId: 'run-1',
            designMd: '',
            review: null,
            approvedBy: null,
          }),
        );
        // Written before the dispatch, so the runner can never call back
        // about a design that does not name it yet.
        expect(
          prdService.setTechnicalDesign.mock.invocationCallOrder[0],
        ).toBeLessThan(github.dispatchWorkflow.mock.invocationCallOrder[0]);
      });

      it('does not move the session', async () => {
        await service.startDesign(readySession() as any, 7);

        expect(sessionRepository.update).not.toHaveBeenCalled();
      });

      // The start dialog saves repos only on a build, and a build waits on an
      // approved design — so a never-built session reaches here with none.
      it("reads the PRD's planned repos when the session has none, and saves them", async () => {
        const session = readySession({ repos: [] });

        await service.startDesign(session as any, 7);

        expect(sessionRepository.update).toHaveBeenCalledWith(
          { id: session.id },
          { repos: ['ally-be'] },
        );
        expect(github.dispatchWorkflow).toHaveBeenCalled();
      });

      it('still refuses when neither the session nor the PRD names a repo', async () => {
        prdService.getOrCreateDoc.mockResolvedValue({
          id: 'doc-1',
          draft: { requirements: [], technicalPlan: { repos: [] } },
        });

        await expect(
          service.startDesign(readySession({ repos: [] }) as any, 7),
        ).rejects.toThrow(/No repos chosen/);
        expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      });

      it('fails the design, not the session, when the dispatch throws', async () => {
        github.dispatchWorkflow.mockRejectedValue(new Error('GitHub down'));
        // The second read sees the drafting design the first call wrote.
        prdService.getOrCreateDoc
          .mockResolvedValueOnce(designedDoc(null))
          .mockResolvedValue(
            designedDoc({ status: 'drafting', runId: 'run-1' }),
          );

        await expect(
          service.startDesign(readySession() as any, 7),
        ).rejects.toBeInstanceOf(ServiceUnavailableException);

        expect(sessionRepository.update).not.toHaveBeenCalled();
        const [, failed] = prdService.setTechnicalDesign.mock.calls[1];
        expect(failed).toEqual(
          expect.objectContaining({ status: 'failed', runId: 'run-1' }),
        );
      });
    });

    describe('approveDesign', () => {
      it('approves a ready design in review and widens the session repos', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(designedDoc(reviewable));

        const approved = await service.approveDesign(readySession() as any, 7);

        expect(approved).toEqual(
          expect.objectContaining({ status: 'approved', approvedBy: 7 }),
        );
        expect(prdService.setTechnicalDesign).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ status: 'approved' }),
          7,
          expect.anything(),
          expect.any(String),
        );
        // The build clones session.repos; the design found ally-web too.
        expect(sessionRepository.update).toHaveBeenCalledWith(
          { id: 'session-1' },
          { repos: ['ally-be', 'ally-web'], updatedBy: 7 },
        );
      });

      it('refuses a design that is not in review', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(
          designedDoc({ ...reviewable, status: 'drafting' }),
        );

        await expect(
          service.approveDesign(readySession() as any, 7),
        ).rejects.toThrow(/Only a design in review/);
      });

      it('refuses a stale design', async () => {
        const doc = designedDoc(reviewable);
        doc.draft.requirements.push({ id: 'R2' });
        prdService.getOrCreateDoc.mockResolvedValue(doc);

        await expect(
          service.approveDesign(readySession() as any, 7),
        ).rejects.toThrow(/PRD changed after this design was drafted/);
        expect(prdService.setTechnicalDesign).not.toHaveBeenCalled();
      });

      it('refuses a design with blockers, saying which', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(
          designedDoc({ ...reviewable, openDecisions: ['Rename it?'] }),
        );

        await expect(
          service.approveDesign(readySession() as any, 7),
        ).rejects.toThrow(/open decision/);
      });
    });

    describe('settling a design run', () => {
      const designRun = {
        id: 'design-run',
        sessionId: 'session-1',
        mode: BuilderRunMode.DESIGN,
        startedAt: new Date(),
        dispatchedAt: new Date(),
      };

      it('never moves the session, whatever the outcome', async () => {
        sessionRepository.findOne.mockResolvedValue(
          readySession({ status: BuilderSessionStatus.PRD_READY }),
        );
        prdService.getOrCreateDoc.mockResolvedValue(designedDoc(reviewable));

        for (const status of [
          BuilderRunStatus.SUCCEEDED,
          BuilderRunStatus.FAILED,
          BuilderRunStatus.CANCELLED,
          BuilderRunStatus.TIMED_OUT,
        ]) {
          await service.settleRun(designRun as any, status, null);
        }

        expect(sessionRepository.update).not.toHaveBeenCalled();
        expect(notificationService.buildFailed).not.toHaveBeenCalled();
        // A design that reached review stays there.
        expect(prdService.setTechnicalDesign).not.toHaveBeenCalled();
      });

      it('marks its own drafting design failed, with the reason', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(
          designedDoc({ status: 'drafting', runId: 'design-run' }),
        );

        await service.settleRun(
          designRun as any,
          BuilderRunStatus.TIMED_OUT,
          'ran out of time',
        );

        expect(prdService.setTechnicalDesign).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            status: 'failed',
            error: 'ran out of time',
          }),
          expect.anything(),
          expect.anything(),
          expect.any(String),
        );
      });

      it('leaves a newer draft alone when an older design run ends', async () => {
        prdService.getOrCreateDoc.mockResolvedValue(
          designedDoc({ status: 'drafting', runId: 'a-newer-run' }),
        );

        await service.settleRun(
          designRun as any,
          BuilderRunStatus.FAILED,
          'boom',
        );

        expect(prdService.setTechnicalDesign).not.toHaveBeenCalled();
      });
    });
  });
});
