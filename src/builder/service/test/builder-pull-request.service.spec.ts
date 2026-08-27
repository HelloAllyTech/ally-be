import { BuilderPullRequestService } from '../builder-pull-request.service';
import {
  BuilderPrFeedbackKind,
  BuilderPrFeedbackStatus,
} from '../../enum/builder.enum';

/**
 * The post-PR loop's judgement: what to record about an open pull request, and
 * when to send an agent at it.
 *
 * Every guard tested here exists because the alternative is a loop that pushes
 * commits to somebody's open pull request without converging — and the person
 * who finds out is the reviewer.
 */

const openPr = (overrides: Record<string, any> = {}) => ({
  id: 'pr-1',
  sessionId: 'session-1',
  repo: 'ally-be',
  branch: 'builder/add-a-thing',
  prNumber: 42,
  prUrl: 'https://github.com/org/ally-be/pull/42',
  merged: false,
  state: 'open',
  ciStatus: null,
  headSha: null,
  fixRunCount: 0,
  ...overrides,
});

describe('BuilderPullRequestService', () => {
  let service: BuilderPullRequestService;
  let repository: any;
  let feedbackRepository: any;
  let sessionRepository: any;
  let notificationService: any;
  let settingsService: any;
  let github: any;
  let buildService: any;

  beforeEach(() => {
    repository = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneOrFail: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn((row) => row),
      increment: jest.fn(),
      listBySession: jest.fn().mockResolvedValue([]),
      listReconcilable: jest.fn().mockResolvedValue([]),
    };
    feedbackRepository = {
      upsertIfNew: jest.fn().mockResolvedValue(true),
      countPending: jest.fn().mockResolvedValue(0),
      listActionable: jest.fn().mockResolvedValue([]),
      listBySession: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      findOne: jest.fn(),
    };
    sessionRepository = { findOne: jest.fn() };
    notificationService = { prsOpened: jest.fn(), fixRunStarted: jest.fn() };
    settingsService = {
      get: jest.fn().mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      }),
    };
    github = {
      isConfigured: true,
      getPullRequest: jest.fn(),
      getCheckRollup: jest.fn().mockResolvedValue(null),
      listPullRequestFeedback: jest.fn().mockResolvedValue([]),
      // Builder's own push by default: the ordinary case, and the one the
      // pre-existing CI tests below were written against.
      getCommitAuthor: jest.fn().mockResolvedValue({
        login: 'ally-builder[bot]',
        name: 'Ally Builder',
      }),
    };
    buildService = {
      dispatchFixRun: jest.fn().mockResolvedValue({ id: 'run-2' }),
    };

    service = new BuilderPullRequestService(
      repository,
      feedbackRepository,
      sessionRepository,
      notificationService,
      settingsService,
      github,
      buildService,
    );
  });

  const reconcileWith = async (
    remote: Record<string, any>,
    pr = openPr(),
    rollup: Record<string, any> | null = null,
  ) => {
    repository.listReconcilable.mockResolvedValue([pr]);
    github.getPullRequest.mockResolvedValue({
      merged: false,
      htmlUrl: pr.prUrl,
      mergedAt: null,
      state: 'open',
      headSha: 'abc1234def',
      ...remote,
    });
    github.getCheckRollup.mockResolvedValue(rollup);
    await service.reconcileOpenPullRequests();
  };

  describe('reconcile', () => {
    it('writes ciStatus, which the entity documented and nothing ever set', async () => {
      await reconcileWith({}, openPr(), {
        state: 'failure',
        failed: ['unit tests'],
        total: 3,
      });

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ ciStatus: 'failure', headSha: 'abc1234def' }),
      );
    });

    it('tells a merged PR apart from one closed without merging', async () => {
      // Indistinguishable before `state` existed — and closed-unmerged is the
      // most informative outcome Builder can have.
      await reconcileWith({ state: 'closed', merged: false });

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ state: 'closed' }),
      );
      // Nothing left to act on, so its feedback stops being actionable.
      expect(feedbackRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ pullRequestId: 'pr-1' }),
        { status: BuilderPrFeedbackStatus.STALE },
      );
      expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
    });

    it('records a failing check keyed by sha, so a new push is a new problem', async () => {
      await reconcileWith({}, openPr(), {
        state: 'failure',
        failed: ['unit tests'],
        total: 2,
      });

      expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: BuilderPrFeedbackKind.CI_FAILURE,
          externalId: 'abc1234def:unit tests',
          // Builder's own commit, so this is its own mess to clean up.
          status: BuilderPrFeedbackStatus.PENDING,
        }),
      );
    });

    /**
     * The guard that stops Builder committing on top of somebody mid-work.
     *
     * The failure mode it prevents is quiet and expensive: a reviewer pushes a
     * commit, CI goes red on THEIR commit, and Builder — which cannot tell
     * whose work it is looking at — sends a runner at the branch they are
     * still editing. The docblock on `considerFixRun` promised this guard for
     * a while before anything implemented it, so these pin the behaviour
     * rather than the wording.
     */
    describe('a failing check on a commit Builder did not write', () => {
      const humanPush = { login: 'a-reviewer', name: 'A Reviewer' };
      const redCi = { state: 'failure', failed: ['unit tests'], total: 2 };

      it('records it as OBSERVED rather than as work', async () => {
        github.getCommitAuthor.mockResolvedValue(humanPush);

        await reconcileWith({}, openPr(), redCi);

        expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: BuilderPrFeedbackKind.CI_FAILURE,
            status: BuilderPrFeedbackStatus.OBSERVED,
          }),
        );
      });

      it('names who pushed, so the row explains itself to a reader', async () => {
        github.getCommitAuthor.mockResolvedValue(humanPush);

        await reconcileWith({}, openPr(), redCi);

        const [row] = feedbackRepository.upsertIfNew.mock.calls.find(
          ([call]: [any]) => call.kind === BuilderPrFeedbackKind.CI_FAILURE,
        );
        expect(row.body).toContain('a-reviewer');
      });

      it('still acts on their review comment — the guard is the CI half only', async () => {
        // A reviewer who pushes AND comments is asking for something. Reading
        // the push as "hands off entirely" would answer a direct request with
        // silence.
        github.getCommitAuthor.mockResolvedValue(humanPush);
        github.listPullRequestFeedback.mockResolvedValue([
          {
            externalId: '900',
            kind: 'review_comment',
            author: 'a-reviewer',
            body: 'This needs a null check.',
            createdAt: null,
          },
        ]);
        feedbackRepository.countPending.mockResolvedValue(1);

        await reconcileWith({}, openPr(), redCi);

        const [comment] = feedbackRepository.upsertIfNew.mock.calls.find(
          ([call]: [any]) => call.kind === BuilderPrFeedbackKind.REVIEW_COMMENT,
        );
        // No status passed at all, so `upsertIfNew` defaults it to PENDING —
        // the comment is ordinary work whoever else pushed.
        expect(comment).not.toHaveProperty('status');
        expect(buildService.dispatchFixRun).toHaveBeenCalled();
      });

      it('treats a commit with no linked GitHub account as somebody else', async () => {
        // `author.login` is null whenever the commit email is not linked to an
        // account. That is a definite answer, not a failed lookup.
        github.getCommitAuthor.mockResolvedValue({
          login: null,
          name: 'Someone Local',
        });

        await reconcileWith({}, openPr(), redCi);

        expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
          expect.objectContaining({
            status: BuilderPrFeedbackStatus.OBSERVED,
          }),
        );
      });

      it('writes nothing at all when it cannot tell who pushed', async () => {
        // `orIgnore` makes the first write final, so a guess during a GitHub
        // blip would be permanent in either direction. Skipping the tick is
        // free — this is polled.
        github.getCommitAuthor.mockResolvedValue(null);

        await reconcileWith({}, openPr(), redCi);

        expect(feedbackRepository.upsertIfNew).not.toHaveBeenCalledWith(
          expect.objectContaining({ kind: BuilderPrFeedbackKind.CI_FAILURE }),
        );
      });

      it('does not send a fix run off the back of it', async () => {
        // The end-to-end shape: OBSERVED is invisible to countPending, which
        // is the whole mechanism.
        github.getCommitAuthor.mockResolvedValue(humanPush);
        feedbackRepository.countPending.mockResolvedValue(0);

        await reconcileWith({}, openPr(), redCi);

        expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
      });
    });

    it('records a human review comment', async () => {
      github.listPullRequestFeedback.mockResolvedValue([
        {
          externalId: '900',
          kind: 'review_comment',
          author: 'a-reviewer',
          body: 'This needs a null check.',
          path: 'src/foo.ts',
          line: 12,
          createdAt: null,
        },
      ]);

      await reconcileWith({});

      expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: BuilderPrFeedbackKind.REVIEW_COMMENT,
          externalId: '900',
          author: 'a-reviewer',
          path: 'src/foo.ts',
          line: 12,
        }),
      );
    });

    it("ignores Builder's own comments, which are not feedback to itself", async () => {
      github.listPullRequestFeedback.mockResolvedValue([
        {
          externalId: '901',
          kind: 'review_comment',
          author: 'ally-builder[bot]',
          body: 'Fixed in abc123.',
          createdAt: null,
        },
      ]);

      await reconcileWith({});

      expect(feedbackRepository.upsertIfNew).not.toHaveBeenCalled();
    });

    it('survives a GitHub failure on one PR without abandoning the rest', async () => {
      repository.listReconcilable.mockResolvedValue([
        openPr({ id: 'pr-1' }),
        openPr({ id: 'pr-2' }),
      ]);
      github.getPullRequest
        .mockRejectedValueOnce(new Error('502'))
        .mockResolvedValueOnce({
          merged: false,
          htmlUrl: 'u',
          mergedAt: null,
          state: 'open',
          headSha: 'sha',
        });

      await expect(
        service.reconcileOpenPullRequests(),
      ).resolves.toBeUndefined();
      expect(github.getPullRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('the auto-fix decision', () => {
    const withPendingFeedback = (count = 1) =>
      feedbackRepository.countPending.mockResolvedValue(count);

    it('sends a fix run when CI is red and the switch is on', async () => {
      withPendingFeedback();
      await reconcileWith({}, openPr(), {
        state: 'failure',
        failed: ['unit tests'],
        total: 1,
      });

      expect(buildService.dispatchFixRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pr-1' }),
      );
    });

    it('does nothing when autoFix is off', async () => {
      // Agreeing Builder may write code is not agreeing it may keep pushing to
      // a branch a human is reviewing.
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: false,
        maxFixRunsPerPr: 3,
      });
      withPendingFeedback();

      await reconcileWith({});

      expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
    });

    it('does nothing when the kill switch is off, whatever autoFix says', async () => {
      settingsService.get.mockResolvedValue({
        enabled: false,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      });
      withPendingFeedback();

      await reconcileWith({});

      expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
    });

    it('stops at the per-PR attempt ceiling', async () => {
      // A fix that cannot fix it will not fix it on the fourth attempt either.
      withPendingFeedback();

      await reconcileWith({}, openPr({ fixRunCount: 3 }));

      expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
    });

    it('does nothing when there is no pending feedback', async () => {
      feedbackRepository.countPending.mockResolvedValue(0);

      await reconcileWith({}, openPr(), {
        state: 'success',
        failed: [],
        total: 4,
      });

      expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
    });
  });

  describe('claimForFix', () => {
    it('marks the items as claimed, so a reconcile tick cannot double-dispatch', async () => {
      feedbackRepository.listActionable.mockResolvedValue([
        { id: 'f-1' },
        { id: 'f-2' },
      ]);

      const items = await service.claimForFix('pr-1', 'run-9');

      expect(items).toHaveLength(2);
      expect(feedbackRepository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: BuilderPrFeedbackStatus.IN_FIX,
          fixRunId: 'run-9',
        }),
      );
    });
  });

  describe('recordFeedbackOutcomes', () => {
    it('records what the fix run did with each item', async () => {
      feedbackRepository.findOne.mockResolvedValue({
        id: 'f-1',
        sessionId: 'session-1',
      });

      const updated = await service.recordFeedbackOutcomes(
        'run-9',
        'session-1',
        [{ feedbackId: 'f-1', status: 'addressed', replyUrl: 'https://x' }],
      );

      expect(updated).toBe(1);
      expect(feedbackRepository.update).toHaveBeenCalledWith(
        { id: 'f-1' },
        expect.objectContaining({
          status: BuilderPrFeedbackStatus.ADDRESSED,
          replyUrl: 'https://x',
        }),
      );
    });

    it('keeps a disagreement as dismissed rather than addressed', async () => {
      // Pushing back in writing is a legitimate outcome; recording it as
      // "addressed" would claim a code change that never happened.
      feedbackRepository.findOne.mockResolvedValue({
        id: 'f-1',
        sessionId: 'session-1',
      });

      await service.recordFeedbackOutcomes('run-9', 'session-1', [
        { feedbackId: 'f-1', status: 'dismissed' },
      ]);

      expect(feedbackRepository.update).toHaveBeenCalledWith(
        { id: 'f-1' },
        expect.objectContaining({
          status: BuilderPrFeedbackStatus.DISMISSED,
        }),
      );
    });

    it("refuses an item that is not this session's", async () => {
      // The runner's key is shared, so the run may only settle its own work.
      feedbackRepository.findOne.mockResolvedValue(null);

      const updated = await service.recordFeedbackOutcomes(
        'run-9',
        'session-1',
        [{ feedbackId: 'someone-elses', status: 'addressed' }],
      );

      expect(updated).toBe(0);
      expect(feedbackRepository.update).not.toHaveBeenCalled();
    });
  });
});
