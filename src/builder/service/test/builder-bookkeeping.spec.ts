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
