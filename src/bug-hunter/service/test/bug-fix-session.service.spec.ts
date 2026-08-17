import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { BugFixSessionService } from '../bug-fix-session.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus, BugHunterMode } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import { resolveReleaseTarget } from '../../constants/bug-fix-session.constants';

const DISPATCHED_AT = new Date('2026-08-17T10:00:00.000Z');

const findingRow = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'finding-1',
    runId: null,
    repo: 'ally-be',
    source: 'reported_bug',
    title: 'Terms link is not formatted correctly',
    description: 'The external emergency-services link renders unstyled.',
    file: 'src/app.ts',
    evidence: null,
    severity: null,
    proven: false,
    touchesGuardedPath: false,
    reportedBugId: null,
    dedupeKey: null,
    status: BugFindingStatus.NEW,
    prUrl: null,
    dispatchedAt: null,
    sessionRunUrl: null,
    releaseTag: null,
    releaseRunId: null,
    releaseRunUrl: null,
    releasedBy: null,
    releasedAt: null,
    createdAt: DISPATCHED_AT,
    updatedAt: DISPATCHED_AT,
    ...overrides,
  }) as BugFinding;

describe('BugFixSessionService', () => {
  let service: BugFixSessionService;
  let findingRepository: {
    update: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    listChildren: jest.Mock;
    listCoordinatingParents: jest.Mock;
    listReleasingParents: jest.Mock;
  };
  let bugFindingService: { getOne: jest.Mock };
  let bugHunterService: {
    getSettings: jest.Mock;
    startRun: jest.Mock;
    closeRun: jest.Mock;
    appendEvent: jest.Mock;
    appendFindingEvent: jest.Mock;
  };
  let github: {
    isConfigured: boolean;
    dispatchWorkflow: jest.Mock;
    findRunSince: jest.Mock;
    getRun: jest.Mock;
    nextPatchTag: jest.Mock;
  };
  let notificationService: { notify: jest.Mock };

  beforeEach(() => {
    findingRepository = {
      update: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn((row: unknown) => row),
      // Most tests are about a standalone bug: no plan, no steps.
      listChildren: jest.fn().mockResolvedValue([]),
      listCoordinatingParents: jest.fn().mockResolvedValue([]),
      listReleasingParents: jest.fn().mockResolvedValue([]),
    };
    bugFindingService = { getOne: jest.fn() };
    bugHunterService = {
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.MANUAL }),
      startRun: jest.fn().mockResolvedValue({ id: 'run-1' }),
      closeRun: jest.fn(),
      appendEvent: jest.fn(),
      appendFindingEvent: jest.fn(),
    };
    github = {
      isConfigured: true,
      dispatchWorkflow: jest.fn().mockResolvedValue(DISPATCHED_AT),
      findRunSince: jest.fn(),
      getRun: jest.fn(),
      nextPatchTag: jest.fn(),
    };
    notificationService = { notify: jest.fn() };

    service = new BugFixSessionService(
      findingRepository as never,
      bugFindingService as never,
      bugHunterService as never,
      github as never,
      notificationService as never,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
    );
  });

  // ── start ────────────────────────────────────────────────────────────────

  describe('start', () => {
    it('dispatches the workflow and parks the finding at QUEUED', async () => {
      const finding = findingRow();
      bugFindingService.getOne.mockResolvedValue(finding);

      await service.start('finding-1', 42);

      expect(bugHunterService.startRun).toHaveBeenCalledWith(
        BugHuntTrigger.FIX_SESSION,
        'ally-be',
      );
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'ally-be',
          workflow: 'bug-fix-session.yml',
          inputs: expect.objectContaining({
            finding_id: 'finding-1',
            run_id: 'run-1',
            api_base_url: 'https://api.example.com',
          }),
        }),
      );
      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({
          status: BugFindingStatus.QUEUED,
          runId: 'run-1',
          dispatchedAt: DISPATCHED_AT,
        }),
      );
      expect(bugHunterService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.SESSION_DISPATCHED,
        }),
      );
    });

    it('refuses while the kill switch is OFF, without touching GitHub', async () => {
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.OFF,
      });

      await expect(service.start('finding-1', 42)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('refuses a second session while one is already in flight', async () => {
      bugFindingService.getOne.mockResolvedValue(
        findingRow({ status: BugFindingStatus.FIXING }),
      );

      await expect(service.start('finding-1', 42)).rejects.toThrow(
        /already running/i,
      );
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('needs a repo when the finding has none — the reported-bug case', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow({ repo: null }));

      await expect(service.start('finding-1', 42)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('accepts an admin-supplied repo for an untriaged finding and stores it', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow({ repo: null }));

      await service.start('finding-1', 42, 'ally-web');

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'ally-web' }),
      );
      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({ repo: 'ally-web' }),
      );
    });

    it('rejects a repo with no fix-session workflow', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow({ repo: null }));

      await expect(
        service.start('finding-1', 42, 'ally-mobile'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('closes the run it opened when the dispatch itself fails', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow());
      github.dispatchWorkflow.mockRejectedValue(new Error('403 from GitHub'));

      await expect(service.start('finding-1', 42)).rejects.toThrow(
        '403 from GitHub',
      );
      expect(bugHunterService.closeRun).toHaveBeenCalledWith(
        'run-1',
        BugHuntRunStatus.FAILED,
        expect.any(Object),
        '403 from GitHub',
      );
      // The finding must NOT be left looking like a session is running.
      expect(findingRepository.update).not.toHaveBeenCalled();
    });
  });

  // ── release ──────────────────────────────────────────────────────────────

  describe('release', () => {
    it('dispatches the next patch tag and parks the finding at RELEASING', async () => {
      bugFindingService.getOne.mockResolvedValue(
        findingRow({ status: BugFindingStatus.MERGED }),
      );
      github.nextPatchTag.mockResolvedValue('v1.4.2');

      await service.release('finding-1', 7);

      expect(github.nextPatchTag).toHaveBeenCalledWith('ally-be', 'v');
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'ally-be',
          workflow: 'production-release.yaml',
          inputs: { version_tag: 'v1.4.2' },
        }),
      );
      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({
          status: BugFindingStatus.RELEASING,
          releaseTag: 'v1.4.2',
          releasedBy: 7,
        }),
      );
    });

    it('retries from RELEASE_FAILED — the fix is on master, only the deploy went red', async () => {
      bugFindingService.getOne.mockResolvedValue(
        findingRow({ status: BugFindingStatus.RELEASE_FAILED }),
      );
      github.nextPatchTag.mockResolvedValue('v1.4.3');

      await service.release('finding-1', 7);

      expect(github.dispatchWorkflow).toHaveBeenCalled();
    });

    it('refuses to release anything that is not merged', async () => {
      bugFindingService.getOne.mockResolvedValue(
        findingRow({ status: BugFindingStatus.PR_OPENED }),
      );

      await expect(service.release('finding-1', 7)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('refuses an ally-web fix that cannot be pinned to one app', async () => {
      bugFindingService.getOne.mockResolvedValue(
        findingRow({
          status: BugFindingStatus.MERGED,
          repo: 'ally-web',
          file: 'libs/ui-shared/src/Button.tsx',
        }),
      );

      await expect(service.release('finding-1', 7)).rejects.toThrow(
        /ships in all three/i,
      );
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });
  });

  // ── reconcile ────────────────────────────────────────────────────────────

  describe('reconcile', () => {
    beforeEach(() => {
      findingRepository.find.mockResolvedValue([]);
    });

    it('does nothing at all when GitHub is not configured', async () => {
      github.isConfigured = false;

      await service.reconcile();

      expect(findingRepository.find).not.toHaveBeenCalled();
    });

    it('attaches the run URL to a queued session once GitHub registers it', async () => {
      findingRepository.find.mockImplementation(({ where }: any) =>
        where.status === BugFindingStatus.QUEUED
          ? [
              findingRow({
                status: BugFindingStatus.QUEUED,
                dispatchedAt: new Date(Date.now() - 60_000),
              }),
            ]
          : [],
      );
      github.findRunSince.mockResolvedValue({
        id: '99',
        htmlUrl: 'https://github.com/run/99',
      });

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith('finding-1', {
        sessionRunUrl: 'https://github.com/run/99',
      });
    });

    it('fails a queued session that never reported in past the timeout', async () => {
      findingRepository.find.mockImplementation(({ where }: any) =>
        where.status === BugFindingStatus.QUEUED
          ? [
              findingRow({
                status: BugFindingStatus.QUEUED,
                sessionRunUrl: 'https://github.com/run/99',
                dispatchedAt: new Date(Date.now() - 45 * 60 * 1000),
              }),
            ]
          : [],
      );

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith('finding-1', {
        status: BugFindingStatus.FAILED,
      });
    });

    it('settles a green release as RELEASED and notifies', async () => {
      findingRepository.find.mockImplementation(({ where }: any) =>
        where.status === BugFindingStatus.RELEASING
          ? [
              findingRow({
                status: BugFindingStatus.RELEASING,
                releaseTag: 'v1.4.2',
                releaseRunId: '99',
                dispatchedAt: new Date(Date.now() - 60_000),
              }),
            ]
          : [],
      );
      github.getRun.mockResolvedValue({
        id: '99',
        htmlUrl: 'https://github.com/run/99',
        status: 'completed',
        conclusion: 'success',
      });

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({ status: BugFindingStatus.RELEASED }),
      );
      expect(bugHunterService.appendFindingEvent).toHaveBeenCalledWith(
        expect.objectContaining({ stage: BugHuntEventStage.RELEASED }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/live in production/i),
        }),
      );
    });

    it('settles a red release as RELEASE_FAILED, not FAILED — the fix is still merged', async () => {
      findingRepository.find.mockImplementation(({ where }: any) =>
        where.status === BugFindingStatus.RELEASING
          ? [
              findingRow({
                status: BugFindingStatus.RELEASING,
                releaseTag: 'v1.4.2',
                releaseRunId: '99',
                dispatchedAt: new Date(Date.now() - 60_000),
              }),
            ]
          : [],
      );
      github.getRun.mockResolvedValue({
        id: '99',
        htmlUrl: 'https://github.com/run/99',
        status: 'completed',
        conclusion: 'failure',
      });

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({ status: BugFindingStatus.RELEASE_FAILED }),
      );
    });

    it('leaves a still-running release alone', async () => {
      findingRepository.find.mockImplementation(({ where }: any) =>
        where.status === BugFindingStatus.RELEASING
          ? [
              findingRow({
                status: BugFindingStatus.RELEASING,
                releaseRunId: '99',
                dispatchedAt: new Date(Date.now() - 60_000),
              }),
            ]
          : [],
      );
      github.getRun.mockResolvedValue({
        id: '99',
        htmlUrl: 'https://github.com/run/99',
        status: 'in_progress',
        conclusion: null,
      });

      await service.reconcile();

      expect(findingRepository.update).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  // ── releasability ────────────────────────────────────────────────────────

  describe('releasability', () => {
    it('offers the button for a merged fix in a mappable repo', async () => {
      expect(
        await service.releasability(
          findingRow({ status: BugFindingStatus.MERGED }),
        ),
      ).toEqual({
        releasable: true,
        target: 'Ally backend (ECS)',
        reason: null,
      });
    });

    it('explains itself when merged but unmappable, rather than silently hiding', async () => {
      const result = await service.releasability(
        findingRow({
          status: BugFindingStatus.MERGED,
          repo: 'ally-web',
          file: 'libs/ui-shared/src/Button.tsx',
        }),
      );

      expect(result.releasable).toBe(false);
      expect(result.reason).toMatch(/ships in all three/i);
    });

    it('gives no reason for a fix that simply is not merged yet', async () => {
      expect(await service.releasability(findingRow())).toEqual({
        releasable: false,
        target: null,
        reason: null,
      });
    });
  });
});

describe('resolveReleaseTarget', () => {
  it.each([
    ['ally-be', 'src/app.ts', 'production-release.yaml', 'v'],
    [
      'ally-web',
      'apps/ally-admin-dashboard/src/pages/BugHunter/BugHunter.tsx',
      'production-release-admin-dashboard.yaml',
      'admin-v',
    ],
    [
      'ally-web',
      'apps/ally-helpline-dashboard/src/x.tsx',
      'production-release-helpline-dashboard.yaml',
      'helpline-v',
    ],
  ])('maps %s/%s to %s', (repo, file, workflow, tagPrefix) => {
    expect(resolveReleaseTarget(repo, file)).toMatchObject({
      workflow,
      tagPrefix,
    });
  });

  it.each([
    ['ally-web', 'libs/ui-shared/src/Button.tsx'],
    ['ally-web', null],
    ['ally-mobile', 'src/App.tsx'],
    [null, 'src/app.ts'],
  ])('refuses to guess for %s/%s', (repo, file) => {
    expect(resolveReleaseTarget(repo, file)).toBeNull();
  });
});

describe('BugFixSessionService — coordinated multi-repo fixes', () => {
  let service: BugFixSessionService;
  let findingRepository: any;
  let bugFindingService: any;
  let bugHunterService: any;
  let github: any;
  let notificationService: any;

  const step = (index: number, overrides: Partial<BugFinding> = {}) =>
    findingRow({
      id: `step-${index}`,
      parentFindingId: 'finding-1',
      stepIndex: index,
      repo: index === 0 ? 'ally-be' : 'ally-web',
      file: index === 0 ? 'src/app.ts' : 'apps/ally-admin-dashboard/src/x.tsx',
      status: BugFindingStatus.BLOCKED,
      ...overrides,
    } as Partial<BugFinding>);

  beforeEach(() => {
    findingRepository = {
      update: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((row) =>
        Promise.resolve({ ...row, id: `step-${row.stepIndex}` }),
      ),
      create: jest.fn((row) => row),
      listChildren: jest.fn().mockResolvedValue([]),
      listCoordinatingParents: jest.fn().mockResolvedValue([]),
      listReleasingParents: jest.fn().mockResolvedValue([]),
    };
    bugFindingService = { getOne: jest.fn() };
    bugHunterService = {
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.MANUAL }),
      startRun: jest.fn().mockResolvedValue({ id: 'run-1' }),
      closeRun: jest.fn(),
      appendEvent: jest.fn(),
      appendFindingEvent: jest.fn(),
    };
    github = {
      isConfigured: true,
      dispatchWorkflow: jest.fn().mockResolvedValue(DISPATCHED_AT),
      findRunSince: jest.fn().mockResolvedValue(null),
      getRun: jest.fn(),
      nextPatchTag: jest.fn().mockResolvedValue('v1.0.1'),
    };
    notificationService = { notify: jest.fn() };

    service = new BugFixSessionService(
      findingRepository,
      bugFindingService,
      bugHunterService,
      github,
      notificationService,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
    );
  });

  describe('recordPlan', () => {
    it('creates one step per repo, in the order given, and starts only the first', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow());

      await service.recordPlan('finding-1', [
        { repo: 'ally-be', summary: 'add the field' },
        { repo: 'ally-web', summary: 'render it' },
      ]);

      expect(findingRepository.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          repo: 'ally-be',
          stepIndex: 0,
          status: BugFindingStatus.NEW,
        }),
      );
      // The second step waits its turn — shipping it early is the exact
      // failure the ordering exists to prevent.
      expect(findingRepository.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          repo: 'ally-web',
          stepIndex: 1,
          status: BugFindingStatus.BLOCKED,
        }),
      );
      expect(github.dispatchWorkflow).toHaveBeenCalledTimes(1);
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'ally-be' }),
      );
      expect(findingRepository.update).toHaveBeenCalledWith('finding-1', {
        status: BugFindingStatus.COORDINATING,
      });
    });

    it('is idempotent — a retried report does not double the plan', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow());
      findingRepository.listChildren.mockResolvedValue([step(0), step(1)]);

      await service.recordPlan('finding-1', [
        { repo: 'ally-be', summary: 'a' },
        { repo: 'ally-web', summary: 'b' },
      ]);

      expect(findingRepository.create).not.toHaveBeenCalled();
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('rejects a one-step plan — that is just a normal fix', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow());
      await expect(
        service.recordPlan('finding-1', [{ repo: 'ally-be', summary: 'a' }]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a plan naming a repo with no fix-session workflow', async () => {
      bugFindingService.getOne.mockResolvedValue(findingRow());
      await expect(
        service.recordPlan('finding-1', [
          { repo: 'ally-be', summary: 'a' },
          { repo: 'ally-mobile', summary: 'b' },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('advancing the plan', () => {
    const coordinating = () =>
      findingRow({ id: 'finding-1', status: BugFindingStatus.COORDINATING });

    it('starts the next step once the one before it is merged', async () => {
      findingRepository.listCoordinatingParents.mockResolvedValue([
        coordinating(),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.MERGED }),
        step(1, { status: BugFindingStatus.BLOCKED }),
      ]);

      await service.reconcile();

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'ally-web' }),
      );
    });

    it('does not run two steps at once', async () => {
      findingRepository.listCoordinatingParents.mockResolvedValue([
        coordinating(),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.FIXING }),
        step(1, { status: BugFindingStatus.BLOCKED }),
      ]);

      await service.reconcile();

      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('makes the parent releasable once every step is merged, and says so', async () => {
      findingRepository.listCoordinatingParents.mockResolvedValue([
        coordinating(),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.MERGED }),
        step(1, { status: BugFindingStatus.MERGED }),
      ]);

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith('finding-1', {
        status: BugFindingStatus.MERGED,
      });
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'action_needed',
          title: expect.stringMatching(/ready to release/i),
        }),
      );
    });

    it('halts the whole plan when a step gets stuck, rather than building on it', async () => {
      findingRepository.listCoordinatingParents.mockResolvedValue([
        coordinating(),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, {
          status: BugFindingStatus.NEEDS_INPUT,
          escalationQuestion: 'Which field name?',
        }),
        step(1, { status: BugFindingStatus.BLOCKED }),
      ]);

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({ status: BugFindingStatus.NEEDS_INPUT }),
      );
      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'action_needed' }),
      );
    });
  });

  describe('sequenced release', () => {
    it('releases only the first step on the admin click', async () => {
      bugFindingService.getOne.mockResolvedValue(
        findingRow({ status: BugFindingStatus.MERGED }),
      );
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.MERGED }),
        step(1, { status: BugFindingStatus.MERGED }),
      ]);

      await service.release('finding-1', 7);

      expect(github.dispatchWorkflow).toHaveBeenCalledTimes(1);
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'ally-be' }),
      );
    });

    it('starts the next release only after the one before it is live', async () => {
      findingRepository.listReleasingParents.mockResolvedValue([
        findingRow({ status: BugFindingStatus.RELEASING, releasedBy: 7 }),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.RELEASED }),
        step(1, { status: BugFindingStatus.MERGED }),
      ]);

      await service.reconcile();

      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'ally-web' }),
      );
    });

    it('waits while a step is still deploying', async () => {
      findingRepository.listReleasingParents.mockResolvedValue([
        findingRow({ status: BugFindingStatus.RELEASING, releasedBy: 7 }),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.RELEASING }),
        step(1, { status: BugFindingStatus.MERGED }),
      ]);

      await service.reconcile();

      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
    });

    it('stops the sequence where it broke, leaving later steps undeployed', async () => {
      findingRepository.listReleasingParents.mockResolvedValue([
        findingRow({ status: BugFindingStatus.RELEASING, releasedBy: 7 }),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.RELEASE_FAILED }),
        step(1, { status: BugFindingStatus.MERGED }),
      ]);

      await service.reconcile();

      expect(github.dispatchWorkflow).not.toHaveBeenCalled();
      expect(findingRepository.update).toHaveBeenCalledWith('finding-1', {
        status: BugFindingStatus.RELEASE_FAILED,
      });
    });

    it('closes the parent once every step is live', async () => {
      findingRepository.listReleasingParents.mockResolvedValue([
        findingRow({ status: BugFindingStatus.RELEASING, releasedBy: 7 }),
      ]);
      findingRepository.listChildren.mockResolvedValue([
        step(0, { status: BugFindingStatus.RELEASED }),
        step(1, { status: BugFindingStatus.RELEASED }),
      ]);

      await service.reconcile();

      expect(findingRepository.update).toHaveBeenCalledWith(
        'finding-1',
        expect.objectContaining({ status: BugFindingStatus.RELEASED }),
      );
    });
  });
});
