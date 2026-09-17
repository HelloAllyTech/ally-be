import { BuilderPullRequestService } from '../builder-pull-request.service';
import { BuilderBuildService } from '../builder-build.service';
import {
  BuilderPrFeedbackKind,
  BuilderPrFeedbackStatus,
  BuilderRunStatus,
  BuilderSessionStatus,
  BuilderStage,
} from '../../enum/builder.enum';

/**
 * The bookkeeping that made a working session look broken.
 *
 * Every one of these was found in a single afternoon on session 34d68cd2,
 * where Builder fixed a real migration collision, pushed it, went green — and
 * the platform reported failure, advised a retry, stopped dispatching, and
 * announced the stoppage into Slack every five minutes.
 */
describe('Builder bookkeeping — reconciling verdicts against evidence', () => {
  describe('the circuit breaker', () => {
    const service = (runs: any[], prs: any[], edited: boolean) => {
      const svc = Object.create(
        BuilderBuildService.prototype,
      ) as BuilderBuildService;
      Object.assign(svc, {
        runRepository: { listRecent: jest.fn().mockResolvedValue(runs) },
        pullRequestRepository: { find: jest.fn().mockResolvedValue(prs) },
        touchedNoFiles: jest.fn().mockResolvedValue(!edited),
      });
      return svc as any;
    };

    const failed = (id: string) => ({
      id,
      sessionId: 's-1',
      status: BuilderRunStatus.FAILED,
    });
    const greenPr = { merged: false, state: 'open', ciStatus: 'success' };

    /**
     * Run 9: fixed the collision, pushed, went green, then ended its turn
     * without reporting. The gate recorded a failure, correctly. Counting it
     * as "nothing is converging" stopped work on a finished pull request.
     */
    it('does not count a failed run that landed green code', async () => {
      const svc = service([failed('r9'), failed('r8')], [greenPr], true);

      await expect(svc.consecutiveFailures('s-1')).resolves.toBe(0);
    });

    /** Edits with red CI is a fix loop making things worse. Still counts. */
    it('counts a failed run whose code is red', async () => {
      const svc = service(
        [failed('r9'), failed('r8')],
        [{ ...greenPr, ciStatus: 'failure' }],
        true,
      );

      await expect(svc.consecutiveFailures('s-1')).resolves.toBe(2);
    });

    /** Green CI with no edits credits the PREVIOUS run's success twice. */
    it('counts a failed run that changed nothing, however green the PR', async () => {
      const svc = service([failed('r9'), failed('r8')], [greenPr], false);

      await expect(svc.consecutiveFailures('s-1')).resolves.toBe(2);
    });
  });

  describe('session outcome', () => {
    const build = (over: Record<string, any> = {}) => {
      const sessionRepository = {
        findOne: jest.fn().mockResolvedValue({
          id: 's-1',
          error: 'no passing test gate',
          status: BuilderSessionStatus.FAILED,
          ...over,
        }),
        update: jest.fn(),
      };
      const svc = Object.create(
        BuilderPullRequestService.prototype,
      ) as BuilderPullRequestService;
      Object.assign(svc, {
        sessionRepository,
        repository: {
          listBySession: jest
            .fn()
            .mockResolvedValue([
              { id: 'pr-1', merged: false, state: 'open', ciStatus: 'success' },
            ]),
        },
        feedbackRepository: { countActionable: jest.fn().mockResolvedValue(0) },
        buildService: { hasBlockingRuns: jest.fn().mockResolvedValue(false) },
        logger: { info: jest.fn(), warn: jest.fn() },
      });
      return { svc: svc as any, sessionRepository };
    };

    it('settles a FAILED session whose pull requests are green', async () => {
      const { svc, sessionRepository } = build();

      await svc.clearStaleSessionError('s-1');

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 's-1' },
        { error: null },
      );
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 's-1' },
        {
          status: BuilderSessionStatus.COMPLETED,
          currentStage: BuilderStage.DONE,
        },
      );
    });

    /** Something is still running: the verdict is not final yet. */
    it('leaves it alone while a run is still in flight', async () => {
      const { svc, sessionRepository } = build();
      svc.buildService.hasBlockingRuns = jest.fn().mockResolvedValue(true);

      await svc.clearStaleSessionError('s-1');

      expect(sessionRepository.update).not.toHaveBeenCalledWith(
        { id: 's-1' },
        expect.objectContaining({ status: BuilderSessionStatus.COMPLETED }),
      );
    });

    /**
     * The state the real session ended in, and the one the first cut of this
     * got wrong. Scoping the evidence to OPEN pull requests meant a session
     * whose work had all been merged — green checks plus a person choosing to
     * take it, the strongest evidence available — was left saying FAILED for
     * ever, because there was nothing open left to examine.
     */
    it('settles on merged pull requests alone', async () => {
      const { svc, sessionRepository } = build();
      svc.repository.listBySession = jest.fn().mockResolvedValue([
        { id: 'pr-1', merged: true, state: 'closed', ciStatus: 'success' },
        { id: 'pr-2', merged: true, state: 'closed', ciStatus: 'success' },
      ]);

      await svc.clearStaleSessionError('s-1');

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { id: 's-1' },
        {
          status: BuilderSessionStatus.COMPLETED,
          currentStage: BuilderStage.DONE,
        },
      );
    });

    /** Closed without merging is a rejection — not ours to reinterpret. */
    it('leaves a session whose pull request was rejected', async () => {
      const { svc, sessionRepository } = build();
      svc.repository.listBySession = jest
        .fn()
        .mockResolvedValue([
          { id: 'pr-1', merged: false, state: 'closed', ciStatus: 'success' },
        ]);

      await svc.clearStaleSessionError('s-1');

      expect(sessionRepository.update).not.toHaveBeenCalled();
    });

    it('does not resurrect a cancelled session', async () => {
      const { svc, sessionRepository } = build({
        status: BuilderSessionStatus.CANCELLED,
        error: null,
      });

      await svc.clearStaleSessionError('s-1');

      expect(sessionRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('CI feedback', () => {
    it('retires CI failures once the head is green', async () => {
      const feedbackRepository = {
        update: jest.fn().mockResolvedValue({ affected: 3 }),
      };
      const svc = Object.create(
        BuilderPullRequestService.prototype,
      ) as BuilderPullRequestService;
      Object.assign(svc, {
        feedbackRepository,
        logger: { info: jest.fn(), warn: jest.fn() },
      });

      await (svc as any).staleCiFeedback('pr-1');

      expect(feedbackRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequestId: 'pr-1',
          kind: BuilderPrFeedbackKind.CI_FAILURE,
        }),
        { status: BuilderPrFeedbackStatus.STALE },
      );
    });
  });
});

/**
 * The guard that refused in silence.
 *
 * A run parked on a question must block a new dispatch — racing the resume
 * would put two runners on one branch. But it must stop blocking once that
 * resume exists, and the refusal must say so. Neither was true: the paused row
 * stays WAITING_FOR_INPUT for ever by design (it is terminal FOR THE RUN), and
 * this was the one guard in `dispatchFixRun` that returned null without a word.
 * A wedged session was indistinguishable from an idle one for four hours.
 */
describe('Builder bookkeeping — the blocking-run guard', () => {
  const service = (blocking: number) => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const svc = Object.create(
      BuilderBuildService.prototype,
    ) as BuilderBuildService;
    Object.assign(svc, {
      sessionRepository: {
        findOne: jest.fn().mockResolvedValue({ id: 's-1', totalCostUsd: 0 }),
      },
      runRepository: {
        countBlockingRuns: jest.fn().mockResolvedValue(blocking),
        listRecent: jest.fn().mockResolvedValue([]),
      },
      pullRequestRepository: { find: jest.fn().mockResolvedValue([]) },
      settingsService: { get: jest.fn() },
      logger,
    });
    return { svc: svc as any, logger };
  };

  const pr = { id: 'pr-1', sessionId: 's-1', repo: 'ally-be', prNumber: 494 };

  it('says why it refused a fix run', async () => {
    const { svc, logger } = service(1);

    await expect(svc.dispatchFixRun(pr, 'because')).resolves.toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('in flight or parked'),
    );
  });

  it('says why it refused a review run', async () => {
    const { svc, logger } = service(1);

    await expect(svc.dispatchReviewRun(pr, 'abc123')).resolves.toBeNull();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('in flight or parked'),
    );
  });
});

/**
 * The sweep has to run over SESSIONS, not over open pull requests.
 *
 * `listReconcilable` filters on `merged: false`, so a session whose pull
 * requests have all merged is iterated by nothing. Putting the outcome
 * reconciliation inside that loop — as the first two attempts at this did —
 * meant it could never run for the one case it exists for: a session left
 * saying FAILED above work that had already shipped and deployed.
 */
describe('Builder bookkeeping — the outcome sweep runs over sessions', () => {
  it('reaches a failed session whose pull requests have all merged', async () => {
    const sessionRepository = {
      listRecentlyFailed: jest
        .fn()
        .mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]),
    };
    const svc = Object.create(
      BuilderPullRequestService.prototype,
    ) as BuilderPullRequestService;
    const settled: string[] = [];
    Object.assign(svc, {
      sessionRepository,
      // No open pull requests anywhere: the loop below the sweep sees nothing.
      repository: { listReconcilable: jest.fn().mockResolvedValue([]) },
      github: { isConfigured: true },
      logger: { info: jest.fn(), warn: jest.fn() },
      clearStaleSessionError: jest.fn(async (id: string) => {
        settled.push(id);
      }),
    });

    await (svc as any).reconcileOpenPullRequests();

    expect(settled).toEqual(['s-1', 's-2']);
  });

  /**
   * Pure database work, so it must not be gated behind the GitHub guard — a
   * dead credential already cost a whole afternoon of silence today.
   */
  it('still sweeps when GitHub is not configured', async () => {
    const svc = Object.create(
      BuilderPullRequestService.prototype,
    ) as BuilderPullRequestService;
    const clearStaleSessionError = jest.fn();
    Object.assign(svc, {
      sessionRepository: {
        listRecentlyFailed: jest.fn().mockResolvedValue([{ id: 's-1' }]),
      },
      repository: { listReconcilable: jest.fn() },
      github: { isConfigured: false },
      logger: { info: jest.fn(), warn: jest.fn() },
      clearStaleSessionError,
    });

    await (svc as any).reconcileOpenPullRequests();

    expect(clearStaleSessionError).toHaveBeenCalledWith('s-1');
  });

  /** One bad session must not stop the rest of the sweep. */
  it('carries on past a session that throws', async () => {
    const clearStaleSessionError = jest
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValue(undefined);
    const svc = Object.create(
      BuilderPullRequestService.prototype,
    ) as BuilderPullRequestService;
    Object.assign(svc, {
      sessionRepository: {
        listRecentlyFailed: jest
          .fn()
          .mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]),
      },
      repository: { listReconcilable: jest.fn().mockResolvedValue([]) },
      github: { isConfigured: true },
      logger: { info: jest.fn(), warn: jest.fn() },
      clearStaleSessionError,
    });

    await (svc as any).reconcileOpenPullRequests();

    expect(clearStaleSessionError).toHaveBeenCalledTimes(2);
  });
});

/**
 * A `failed` release that was shipped by other means.
 *
 * `failed` was terminal — nothing ever re-read it. So a pull request whose
 * automatic release failed stayed marked "merged but NOT deployed" for good,
 * even after a person cut the release by hand minutes later. ally-web#658 is
 * the case: Builder proposed `admin-v0.0.1` for an app on 1.88, the workflow
 * rightly refused it, and the code shipped in admin-v1.88.0 twenty minutes
 * afterwards with the row still claiming otherwise.
 *
 * It matters more now the roadmap reads these rows to decide whether an
 * opportunity was delivered: a stuck `failed` keeps shipped work looking
 * unshipped, and refuses to be fixed by the act of releasing it properly.
 */
describe('Builder bookkeeping — a failed release that actually shipped', () => {
  const mergedAt = new Date('2026-09-17T17:18:00.000Z');

  const build = (over: Record<string, any> = {}) => {
    const repository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'pr-1',
          repo: 'ally-web',
          prNumber: 658,
          merged: true,
          mergedAt,
          releaseState: 'failed',
          releaseTag: 'admin-v0.0.1',
        },
      ]),
      update: jest.fn(),
    };
    const github = {
      isConfigured: true,
      listPullRequestFiles: jest.fn().mockResolvedValue({
        files: ['apps/ally-admin-dashboard/src/x.tsx'],
        truncated: false,
      }),
      findSuccessfulRunSince: jest
        .fn()
        .mockResolvedValue({ id: '99', htmlUrl: 'https://run/99' }),
      ...over,
    };
    const service = Object.create(
      BuilderPullRequestService.prototype,
    ) as BuilderPullRequestService;
    Object.assign(service, {
      repository,
      github,
      logger: { info: jest.fn(), warn: jest.fn() },
    });
    return { service: service as any, repository, github };
  };

  it('corrects the row when a release succeeded after the merge', async () => {
    const { service, repository, github } = build();

    await service.reconcileFailedReleases();

    expect(github.findSuccessfulRunSince).toHaveBeenCalledWith(
      expect.objectContaining({ since: mergedAt }),
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'pr-1' },
      expect.objectContaining({
        releaseState: 'released',
        releaseRunUrl: 'https://run/99',
      }),
    );
  });

  /**
   * The tag recorded is the one we TRIED and failed with. Leaving it beside a
   * `released` state would state something untrue.
   */
  it('clears the tag it failed with rather than keeping it', async () => {
    const { service, repository } = build();

    await service.reconcileFailedReleases();

    expect(repository.update.mock.calls[0][1].releaseTag).toBeNull();
  });

  it('leaves the row alone when nothing has been released since', async () => {
    const { service, repository } = build({
      findSuccessfulRunSince: jest.fn().mockResolvedValue(null),
    });

    await service.reconcileFailedReleases();

    expect(repository.update).not.toHaveBeenCalled();
  });

  /**
   * A truncated file list cannot attribute the work to one deployable, and
   * which app shipped is the wrong thing to guess at.
   */
  it('refuses to attribute a pull request it could not read fully', async () => {
    const { service, repository, github } = build({
      listPullRequestFiles: jest
        .fn()
        .mockResolvedValue({ files: [], truncated: true }),
    });

    await service.reconcileFailedReleases();

    expect(github.findSuccessfulRunSince).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  /** Three apps live in ally-web; a change spanning them names no one target. */
  it('refuses when the files span more than one deployable', async () => {
    const { service, repository } = build({
      listPullRequestFiles: jest.fn().mockResolvedValue({
        files: [
          'apps/ally-admin-dashboard/src/x.tsx',
          'apps/ally-helpline-dashboard/src/y.tsx',
        ],
        truncated: false,
      }),
    });

    await service.reconcileFailedReleases();

    expect(repository.update).not.toHaveBeenCalled();
  });
});
