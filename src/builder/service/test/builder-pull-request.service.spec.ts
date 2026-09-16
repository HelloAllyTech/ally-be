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
  reviewRunCount: 0,
  reviewedSha: null,
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
  let eventRepository: any;
  let releaseService: any;

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
      countActionable: jest.fn().mockResolvedValue(0),
      listActionable: jest.fn().mockResolvedValue([]),
      listBySession: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      findOne: jest.fn(),
    };
    sessionRepository = { findOne: jest.fn() };
    notificationService = {
      prsOpened: jest.fn(),
      fixRunStarted: jest.fn(),
      releaseFailed: jest.fn(),
      releaseSkipped: jest.fn(),
    };
    settingsService = {
      get: jest.fn().mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      }),
    };
    github = {
      isConfigured: true,
      listPullRequestFiles: jest
        .fn()
        .mockResolvedValue({ files: ['src/a.ts'], truncated: false }),
      getPullRequest: jest.fn(),
      getCheckRollup: jest.fn().mockResolvedValue(null),
      listPullRequestFeedback: jest.fn().mockResolvedValue([]),
      // Builder's own push by default: the ordinary case, and the one the
      // pre-existing CI tests below were written against.
      getCommitAuthor: jest.fn().mockResolvedValue({
        login: 'ally-builder[bot]',
        name: 'Ally Builder',
      }),
      mergePullRequest: jest
        .fn()
        .mockResolvedValue({ merged: true, message: null }),
      updatePullRequestBranch: jest
        .fn()
        .mockResolvedValue({ updated: true, message: null }),
      approvePullRequest: jest
        .fn()
        .mockResolvedValue({ approved: true, message: null }),
    };
    buildService = {
      dispatchFixRun: jest.fn().mockResolvedValue({ id: 'run-2' }),
      dispatchReviewRun: jest.fn().mockResolvedValue({ id: 'run-3' }),
    };

    releaseService = {
      dispatch: jest
        .fn()
        .mockResolvedValue({ tag: 'v1.2.3', dispatchedAt: new Date() }),
      resolveRun: jest
        .fn()
        .mockResolvedValue({ id: '99', htmlUrl: 'https://run' }),
      poll: jest.fn().mockResolvedValue({
        state: 'succeeded',
        runUrl: 'https://run',
        detail: 'success',
      }),
    };

    eventRepository = {
      latestOfType: jest.fn().mockResolvedValue(null),
      listByRun: jest.fn().mockResolvedValue([]),
    };

    service = new BuilderPullRequestService(
      repository,
      feedbackRepository,
      sessionRepository,
      notificationService,
      settingsService,
      github,
      eventRepository,
      releaseService,
      { adminBaseUrl: 'https://admin.example.com' } as never,
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

  /**
   * The run's own review, put on the pull request it cleared.
   *
   * The comment is posted on FIRST SIGHT only. A retry or a resumed run
   * re-reports the same branch, and stacking a second identical review on a
   * thread someone is reading is how a useful comment becomes noise.
   */
  describe('the review summary on a new pull request', () => {
    const incoming = [
      {
        repo: 'ally-be',
        branch: 'builder/x',
        prNumber: 42,
        prUrl: 'https://github.com/o/ally-be/pull/42',
        title: 'x',
      },
    ];

    beforeEach(() => {
      // The real repository returns the saved row; the shared mock does not.
      repository.save.mockImplementation((row: unknown) => row);
      github.createIssueComment = jest.fn().mockResolvedValue('https://c');
      eventRepository.latestOfType.mockResolvedValue({
        type: 'verification',
        payload: {
          verdict: 'pass',
          objections: [],
          checkedRequirements: ['R1'],
        },
      });
      eventRepository.listByRun.mockResolvedValue([
        { type: 'gate_result', payload: { passed: true, trusted: true } },
      ]);
    });

    it('comments once when the pull request is first recorded', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.recordFromRunner('s1', 'run-1', incoming);

      expect(github.createIssueComment).toHaveBeenCalledTimes(1);
      const [repo, number, body] = github.createIssueComment.mock.calls[0];
      expect(repo).toBe('ally-be');
      expect(number).toBe(42);
      expect(body).toContain('Independent review');
      expect(body).toContain('R1');
    });

    it('does not comment again when the same branch is re-reported', async () => {
      repository.findOne.mockResolvedValue({ id: 'pr-1' });

      await service.recordFromRunner('s1', 'run-1', incoming);

      expect(github.createIssueComment).not.toHaveBeenCalled();
    });

    /** Telemetry must never fail the pull request it was describing. */
    it('swallows a GitHub failure', async () => {
      repository.findOne.mockResolvedValue(null);
      github.createIssueComment.mockRejectedValue(new Error('502'));

      await expect(
        service.recordFromRunner('s1', 'run-1', incoming),
      ).resolves.toHaveLength(1);
    });

    it('posts nothing when the run recorded no review and no gate', async () => {
      repository.findOne.mockResolvedValue(null);
      eventRepository.latestOfType.mockResolvedValue(null);
      eventRepository.listByRun.mockResolvedValue([]);

      await service.recordFromRunner('s1', 'run-1', incoming);

      expect(github.createIssueComment).not.toHaveBeenCalled();
    });
  });

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

    /**
     * The second guard: a check that IS ours and still cannot be satisfied.
     *
     * The docs guard wants a `Wiki-PR:` trailer pointing at a pull request in
     * a repo the runner cannot clone, so left as PENDING it spends every one
     * of `maxFixRunsPerPr` attempts changing nothing. These pin that it is
     * recorded, not acted on — and, more importantly, that the suppression is
     * per check rather than per commit.
     */
    describe('a failing check no fix run could satisfy', () => {
      const docsRed = { state: 'failure', failed: ['docs-guard'], total: 2 };

      it('records it as OBSERVED even though Builder wrote the commit', async () => {
        await reconcileWith({}, openPr(), docsRed);

        expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: BuilderPrFeedbackKind.CI_FAILURE,
            externalId: 'abc1234def:docs-guard',
            status: BuilderPrFeedbackStatus.OBSERVED,
          }),
        );
      });

      it('says why, so the row does not read as Builder ignoring CI', async () => {
        await reconcileWith({}, openPr(), docsRed);

        const [row] = feedbackRepository.upsertIfNew.mock.calls.find(
          ([call]: [any]) => call.kind === BuilderPrFeedbackKind.CI_FAILURE,
        );
        expect(row.body).toContain('Wiki-PR');
      });

      it('matches the name GitHub actually reports, whichever spelling', async () => {
        // The job id is `docs-guard`; the workflow's own name is "Docs guard".
        // Which one reaches the checks API is GitHub's business, not ours.
        await reconcileWith({}, openPr(), {
          state: 'failure',
          failed: ['Docs guard'],
          total: 2,
        });

        expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
          expect.objectContaining({
            status: BuilderPrFeedbackStatus.OBSERVED,
          }),
        );
      });

      it('still counts a real failure on the same commit as work', async () => {
        // The case that makes this per-check: one push fails the docs guard
        // AND a test. Suppressing the commit would sink the test failure too.
        await reconcileWith({}, openPr(), {
          state: 'failure',
          failed: ['docs-guard', 'unit tests'],
          total: 3,
        });

        const rows = feedbackRepository.upsertIfNew.mock.calls
          .map(([call]: [any]) => call)
          .filter(
            (call: any) => call.kind === BuilderPrFeedbackKind.CI_FAILURE,
          );

        expect(rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              externalId: 'abc1234def:docs-guard',
              status: BuilderPrFeedbackStatus.OBSERVED,
            }),
            expect.objectContaining({
              externalId: 'abc1234def:unit tests',
              status: BuilderPrFeedbackStatus.PENDING,
            }),
          ]),
        );
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

  /**
   * The merge button.
   *
   * Builder opens pull requests and stops, and on the repos that matter it
   * could not merge even if it should — `master` wants an approving review and
   * the bot holds only `write`. What it can remove is the errand: Bug Hunter
   * measured 89 of 122 bot pull requests merged by hand, nearly all within the
   * hour. So these pin the refusals, not the happy path — every one of them is
   * a case where merging anyway would be worse than not having the button.
   */
  describe('mergePullRequest', () => {
    const green = { state: 'success', failed: [], total: 3 };

    const arrange = (pr: any, remote: any, rollup: any = green) => {
      repository.findOne.mockResolvedValue(pr);
      github.getPullRequest.mockResolvedValue(remote);
      github.getCheckRollup.mockResolvedValue(rollup);
    };

    it('merges a green PR and records who decided', async () => {
      arrange(openPr(), {
        merged: false,
        state: 'open',
        headSha: 'abc1234',
      });
      github.mergePullRequest.mockResolvedValue({
        merged: true,
        message: null,
      });

      await service.mergePullRequest('session-1', 'pr-1', 7);

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ merged: true, decidedBy: 7 }),
      );
    });

    it('refuses red checks rather than merging past them', async () => {
      arrange(
        openPr(),
        { merged: false, state: 'open', headSha: 'abc1234' },
        { state: 'failure', failed: ['unit tests'], total: 3 },
      );

      await expect(
        service.mergePullRequest('session-1', 'pr-1', 7),
      ).rejects.toThrow(/red/i);
      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    it('refuses when the checks cannot be read — unreadable is not green', async () => {
      arrange(openPr(), { merged: false, state: 'open', headSha: 'abc' }, null);

      await expect(
        service.mergePullRequest('session-1', 'pr-1', 7),
      ).rejects.toThrow(/blind/i);
      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    it('refuses a PR with no checks at all', async () => {
      arrange(
        openPr(),
        { merged: false, state: 'open', headSha: 'abc' },
        { state: 'none', failed: [], total: 0 },
      );

      await expect(
        service.mergePullRequest('session-1', 'pr-1', 7),
      ).rejects.toThrow(/no checks/i);
    });

    it("relays GitHub's refusal instead of forcing past it", async () => {
      // A required review is exactly the gate this button must not bypass.
      arrange(openPr(), { merged: false, state: 'open', headSha: 'abc' });
      github.mergePullRequest.mockResolvedValue({
        merged: false,
        message: 'At least 1 approving review is required.',
      });

      await expect(
        service.mergePullRequest('session-1', 'pr-1', 7),
      ).rejects.toThrow(/approving review/i);
      expect(repository.update).not.toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ merged: true }),
      );
    });

    it('settles the row when somebody merged it on GitHub first', async () => {
      // The outcome the admin wanted already happened; erroring would be perverse.
      arrange(openPr(), { merged: true, state: 'closed', headSha: 'abc' });

      await service.mergePullRequest('session-1', 'pr-1', 7);

      expect(github.mergePullRequest).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ merged: true }),
      );
    });

    it("refuses a pull request that is not this session's", async () => {
      repository.findOne.mockResolvedValue(openPr({ sessionId: 'other' }));

      await expect(
        service.mergePullRequest('session-1', 'pr-1', 7),
      ).rejects.toThrow(/not part of session/i);
    });
  });

  /**
   * The caller that did not exist: Builder reviewing its own open pull request.
   *
   * Before this, Builder verified its work before opening a PR and nothing read
   * it again — so an independent review was a thing a human did by hand on
   * every pull request, and the fix loop underneath sat idle for want of
   * anything to act on.
   *
   * Every guard below is a way that loop goes wrong if it fires too eagerly.
   * A finding becomes a PENDING row, a PENDING row earns a fix run, and a fix
   * run pushes a commit into a review someone may be reading.
   */
  describe('deciding to review a pull request', () => {
    const green = { state: 'success', failed: [] };

    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        autoReviewEnabled: true,
        maxFixRunsPerPr: 3,
      });
    });

    it('reviews a green pull request it has not read yet', async () => {
      const pr = openPr();
      await reconcileWith({ headSha: 'abc1234def' }, pr, green);

      expect(buildService.dispatchReviewRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pr-1' }),
        'abc1234def',
      );
    });

    /**
     * Review is the safer half — it writes findings and touches no branch — so
     * it gets its own switch. Turning review on while fixes stay off is the
     * useful middle setting, and it has to actually be reachable.
     */
    it('stays off when only auto-fix is enabled', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        autoReviewEnabled: false,
        maxFixRunsPerPr: 3,
      });

      await reconcileWith({ headSha: 'abc1234def' }, openPr(), green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('does not re-read a head sha it has already reviewed', async () => {
      const pr = openPr({ reviewedSha: 'abc1234def', reviewRunCount: 1 });
      await reconcileWith({ headSha: 'abc1234def' }, pr, green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('reviews again once a fix run has moved the branch on', async () => {
      const pr = openPr({ reviewedSha: 'oldsha11', reviewRunCount: 1 });
      await reconcileWith({ headSha: 'newsha22' }, pr, green);

      expect(buildService.dispatchReviewRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'pr-1' }),
        'newsha22',
      );
    });

    /**
     * A reviewer reading a diff that does not compile spends its findings
     * restating the compiler's, and the fix loop already owns red CI.
     */
    it('leaves a red pull request to the fix loop', async () => {
      await reconcileWith({ headSha: 'abc1234def' }, openPr(), {
        state: 'failure',
        failed: ['Jest'],
      });

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('waits rather than racing checks that are still running', async () => {
      await reconcileWith({ headSha: 'abc1234def' }, openPr(), {
        state: 'pending',
        failed: [],
      });

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    /**
     * review -> fix -> new head sha -> review is a loop whose only natural end
     * is a human closing the pull request.
     */
    it('stops at the ceiling', async () => {
      const pr = openPr({ reviewRunCount: 2, reviewedSha: 'oldsha11' });
      await reconcileWith({ headSha: 'newsha22' }, pr, green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('waits while there is feedback a fix run has not dealt with', async () => {
      feedbackRepository.countPending.mockResolvedValue(1);

      await reconcileWith({ headSha: 'abc1234def' }, openPr(), green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    /**
     * A review run leaves an active run behind, and `dispatchFixRun` refuses to
     * race one — so asking for both in a tick gets the second silently refused
     * and reads as a bug from the outside.
     */
    it('does not also ask for a fix run in the same tick', async () => {
      feedbackRepository.countPending.mockResolvedValue(0);

      await reconcileWith({ headSha: 'abc1234def' }, openPr(), green);

      expect(buildService.dispatchReviewRun).toHaveBeenCalled();
      expect(buildService.dispatchFixRun).not.toHaveBeenCalled();
    });

    /**
     * When the reviewer declines (budget, concurrency, an in-flight run), the
     * tick must fall through rather than skip the fix loop on the strength of
     * a review that never happened.
     */
    it('still considers a fix run when the review was refused', async () => {
      buildService.dispatchReviewRun.mockResolvedValue(null);
      feedbackRepository.countPending
        .mockResolvedValueOnce(0)
        .mockResolvedValue(1);

      await reconcileWith({ headSha: 'abc1234def' }, openPr(), green);

      expect(buildService.dispatchFixRun).toHaveBeenCalled();
    });
  });

  describe('recording what a review run found', () => {
    it('writes findings as pending work the fix loop already looks for', async () => {
      repository.findOne.mockResolvedValue(openPr());

      const recorded = await service.recordReviewFindings(
        'run-3',
        'session-1',
        'pr-1',
        [
          {
            key: 'null-tenant',
            body: 'Dereferences a null tenant.',
            path: 'a.ts',
            line: 7,
          },
        ],
      );

      expect(recorded).toBe(1);
      expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
        expect.objectContaining({
          pullRequestId: 'pr-1',
          kind: BuilderPrFeedbackKind.AGENT_REVIEW,
          externalId: 'run-3:null-tenant',
          path: 'a.ts',
          line: 7,
        }),
      );
    });

    /**
     * Keyed on the run so a retried report is idempotent, but a later review of
     * a newer head sha is a different run and genuinely new work.
     */
    it('keys on the run, so a retried report does not double-record', async () => {
      repository.findOne.mockResolvedValue(openPr());

      await service.recordReviewFindings('run-3', 'session-1', 'pr-1', [
        { body: 'first' },
        { body: 'second' },
      ]);

      const keys = feedbackRepository.upsertIfNew.mock.calls.map(
        (call: any[]) => call[0].externalId,
      );
      expect(keys).toEqual(['run-3:0', 'run-3:1']);
    });

    /** A clean review is a result, not a failure. */
    it('accepts an empty report', async () => {
      repository.findOne.mockResolvedValue(openPr());

      await expect(
        service.recordReviewFindings('run-3', 'session-1', 'pr-1', []),
      ).resolves.toBe(0);
      expect(feedbackRepository.upsertIfNew).not.toHaveBeenCalled();
    });

    it('ignores a finding with no text rather than filing an empty row', async () => {
      repository.findOne.mockResolvedValue(openPr());

      const recorded = await service.recordReviewFindings(
        'run-3',
        'session-1',
        'pr-1',
        [{ body: '   ' }, { body: 'real' }],
      );

      expect(recorded).toBe(1);
    });

    it('refuses a pull request belonging to another session', async () => {
      repository.findOne.mockResolvedValue(null);

      const recorded = await service.recordReviewFindings(
        'run-3',
        'session-1',
        'pr-9',
        [{ body: 'anything' }],
      );

      expect(recorded).toBe(0);
      expect(feedbackRepository.upsertIfNew).not.toHaveBeenCalled();
    });
  });

  /**
   * The step that actually blocked every Builder pull request.
   *
   * `master` requires an approving review, the bot holds only `write`, and
   * nothing in the system ever approved — so a green, reviewed, finding-free PR
   * still waited on a human to click Approve or an admin to override branch
   * protection. These tests are about when a machine may say "this is fine",
   * which is the strongest thing Builder can assert about its own work.
   */
  describe('approving on a clean review', () => {
    const green = { state: 'success', failed: [] };

    const settings = (over: Record<string, any> = {}) => ({
      enabled: true,
      autoFixEnabled: true,
      autoReviewEnabled: true,
      autoApproveEnabled: true,
      maxFixRunsPerPr: 3,
      ...over,
    });

    beforeEach(() => {
      settingsService.get.mockResolvedValue(settings());
      repository.findOne.mockResolvedValue(openPr());
      github.getPullRequest.mockResolvedValue({
        state: 'open',
        merged: false,
        headSha: 'abc1234def',
        mergedAt: null,
        htmlUrl: 'https://github.com/o/ally-be/pull/42',
      });
      github.getCheckRollup.mockResolvedValue(green);
    });

    const cleanReview = () =>
      service.recordReviewFindings('run-3', 'session-1', 'pr-1', []);

    it('approves a green pull request its review found nothing in', async () => {
      await cleanReview();

      expect(github.approvePullRequest).toHaveBeenCalledWith(
        'ally-be',
        42,
        expect.stringContaining("Builder's review agent"),
      );
    });

    /** Anyone reading the PR should be able to tell a machine approved it. */
    it('says plainly that the approval is a machine review', async () => {
      await cleanReview();

      const body = github.approvePullRequest.mock.calls[0][2] as string;
      expect(body).toContain('machine review, not a human one');
    });

    it('never approves when a review found something', async () => {
      repository.findOne.mockResolvedValue(openPr());

      await service.recordReviewFindings('run-3', 'session-1', 'pr-1', [
        { body: 'Dereferences a null tenant.' },
      ]);

      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    it('stays off unless auto-approve is explicitly enabled', async () => {
      settingsService.get.mockResolvedValue(
        settings({ autoApproveEnabled: false }),
      );

      await cleanReview();

      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    /**
     * The row's ciStatus was written by the tick that dispatched the review,
     * and a check can go red in the minutes a review takes. Approving on a
     * stale green is the mistake that makes an approval worthless.
     */
    it('re-reads CI rather than trusting the status it was dispatched on', async () => {
      github.getCheckRollup.mockResolvedValue({
        state: 'failure',
        failed: ['Jest'],
      });

      await cleanReview();

      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    it('does not approve while checks are still running', async () => {
      github.getCheckRollup.mockResolvedValue({ state: 'pending', failed: [] });

      await cleanReview();

      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    /**
     * Findings from an earlier review that a fix run has not finished with mean
     * the pull request is mid-conversation, and its diff is about to change.
     */
    it('does not approve while earlier findings are still being fixed', async () => {
      feedbackRepository.countActionable.mockResolvedValue(2);

      await cleanReview();

      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    it('does not approve a pull request that has already closed', async () => {
      github.getPullRequest.mockResolvedValue({
        state: 'closed',
        merged: false,
        headSha: 'abc1234def',
        mergedAt: null,
        htmlUrl: 'https://github.com/o/ally-be/pull/42',
      });

      await cleanReview();

      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    /**
     * GitHub refuses to let an author approve its own pull request. If the
     * server token ever becomes the same identity as the runner's bot, that
     * refusal is something an admin has to read — not a silent no-op.
     */
    it('reports a refusal rather than failing the report', async () => {
      github.approvePullRequest.mockResolvedValue({
        approved: false,
        message: 'Can not approve your own pull request',
      });

      await expect(cleanReview()).resolves.toBe(0);
    });
  });

  /**
   * Keeping the branch current.
   *
   * A pull request that has fallen behind master cannot be merged, and Builder
   * had no way to fix that itself — both of today's builder PRs went stale and
   * each needed a hand rebase, one of them twice.
   */
  describe('keeping a stale branch up to date', () => {
    const behind = { mergeableState: 'behind' };

    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      });
    });

    it('merges master into a branch that has fallen behind', async () => {
      await reconcileWith({ headSha: 'abc1234def', ...behind });

      expect(github.updatePullRequestBranch).toHaveBeenCalledWith(
        'ally-be',
        42,
        'abc1234def',
      );
    });

    /**
     * `dirty` is a real conflict needing a person or a fix run, and `blocked`
     * is a missing approval. Merging master in fixes neither, and trying would
     * burn an API call every tick forever.
     */
    it('leaves a conflicted branch alone', async () => {
      await reconcileWith({ headSha: 'abc1234def', mergeableState: 'dirty' });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    it('does nothing when the branch is already current', async () => {
      await reconcileWith({ headSha: 'abc1234def', mergeableState: 'clean' });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    /**
     * Once somebody else has pushed, they are mid-work on the branch, and a
     * merge commit landing underneath them is how an agent becomes the reason
     * nobody reviews its pull requests.
     */
    it('does not touch a branch somebody else pushed to', async () => {
      github.getCommitAuthor.mockResolvedValue({
        login: 'a-person',
        name: 'A Person',
      });

      await reconcileWith({ headSha: 'abc1234def', ...behind });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    /** "Could not tell who pushed" is not "we pushed". */
    it('skips the tick when the author cannot be read', async () => {
      github.getCommitAuthor.mockResolvedValue(null);

      await reconcileWith({ headSha: 'abc1234def', ...behind });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    it('respects the same switch that governs pushing to an open PR', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: false,
        maxFixRunsPerPr: 3,
      });

      await reconcileWith({ headSha: 'abc1234def', ...behind });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
    });
  });

  /**
   * The last step of the loop, and the only one that changes what real users
   * are running.
   */
  describe('releasing a merged pull request', () => {
    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReleaseEnabled: true,
        maxFixRunsPerPr: 3,
      });
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        title: 'x',
      });
    });

    const merge = (pr = openPr()) =>
      reconcileWith(
        { merged: true, mergedAt: new Date(), state: 'closed' },
        pr,
      );

    it('dispatches a release when a pull request merges', async () => {
      await merge();

      expect(releaseService.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ repo: 'ally-be' }),
        'master',
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ releaseState: 'releasing' }),
      );
    });

    it('stays off unless auto-release is enabled', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReleaseEnabled: false,
        maxFixRunsPerPr: 3,
      });

      await merge();

      expect(releaseService.dispatch).not.toHaveBeenCalled();
    });

    /** Claimed before the dispatch, so a tick mid-flight cannot fire a second. */
    it('never releases the same pull request twice', async () => {
      await merge(openPr({ releaseState: 'releasing' }));

      expect(releaseService.dispatch).not.toHaveBeenCalled();
    });

    /**
     * The real constraint on ally-web: a change under libs/ ships inside all
     * three frontends, so releasing only the apps whose paths matched would
     * silently under-deploy it.
     */
    it('refuses to guess when a change also touches shared code', async () => {
      github.listPullRequestFiles.mockResolvedValue({
        files: [
          'apps/ally-admin-dashboard/src/a.tsx',
          'libs/ui-shared/src/b.tsx',
        ],
        truncated: false,
      });

      await merge(openPr({ repo: 'ally-web' }));

      expect(releaseService.dispatch).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        { releaseState: 'skipped' },
      );
      expect(notificationService.releaseSkipped).toHaveBeenCalled();
    });

    /** A truncated listing is "we do not know", not "nothing changed". */
    it('refuses when the file list could not be read in full', async () => {
      github.listPullRequestFiles.mockResolvedValue({
        files: ['src/a.ts'],
        truncated: true,
      });

      await merge();

      expect(releaseService.dispatch).not.toHaveBeenCalled();
      expect(notificationService.releaseSkipped).toHaveBeenCalled();
    });

    it('skips a repo with no release pipeline, rather than retrying forever', async () => {
      await merge(openPr({ repo: 'ally-mobile' }));

      expect(releaseService.dispatch).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        { releaseState: 'skipped' },
      );
    });

    it('releases both apps when one pull request spans two of them', async () => {
      github.listPullRequestFiles.mockResolvedValue({
        files: [
          'apps/ally-admin-dashboard/src/a.tsx',
          'apps/ally-helpline-dashboard/src/b.tsx',
        ],
        truncated: false,
      });

      await merge(openPr({ repo: 'ally-web' }));

      expect(releaseService.dispatch).toHaveBeenCalledTimes(2);
    });
  });

  /**
   * The half that makes releasing automatically defensible rather than
   * reckless. On 2026-09-15 an ally-be release passed every check, failed to
   * boot, and was rolled back by the ECS circuit breaker — and nothing noticed
   * for the better part of an hour.
   */
  describe('watching a dispatched release', () => {
    const releasing = () =>
      repository.find.mockResolvedValue([
        openPr({
          releaseState: 'releasing',
          releaseTag: 'v1.2.3',
          releaseRunId: '99',
          releaseDispatchedAt: new Date(),
        }),
      ]);

    beforeEach(() => {
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        title: 'x',
      });
    });

    it('marks a successful release live', async () => {
      releasing();

      await service.reconcileReleases();

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ releaseState: 'released' }),
      );
      expect(notificationService.releaseFailed).not.toHaveBeenCalled();
    });

    /** Merged but not deployed is the state that must never pass quietly. */
    it('shouts when a release fails', async () => {
      releasing();
      releaseService.poll.mockResolvedValue({
        state: 'failed',
        runUrl: 'https://run',
        detail: 'failure',
      });

      await service.reconcileReleases();

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ releaseState: 'failed' }),
      );
      expect(notificationService.releaseFailed).toHaveBeenCalledWith(
        expect.anything(),
        'ally-be',
        42,
        'v1.2.3',
        'failure',
        'https://run',
      );
    });

    it('says nothing while a release is still running', async () => {
      releasing();
      releaseService.poll.mockResolvedValue({
        state: 'running',
        runUrl: null,
        detail: null,
      });

      await service.reconcileReleases();

      expect(notificationService.releaseFailed).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({ releaseState: 'released' }),
      );
    });
  });

  /**
   * Whose pushes are Builder's own.
   *
   * One predicate decides two things — whose comments are not feedback to
   * itself, and whose commits it may act on top of — and it was wrong in
   * production for both. It matched `ally-builder*` while every runner pushes
   * as `adminbughunterhelloallyai`, so Builder read its own branches as
   * somebody else's: it never brought a stale branch up to date, and it filed
   * its own failing checks as OBSERVED, which `countPending` ignores, so the
   * fix loop never fired on its own red CI.
   */
  describe('recognising its own pushes', () => {
    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      });
    });

    it('treats the account runners actually push as its own', async () => {
      github.getCommitAuthor.mockResolvedValue({
        login: 'adminbughunterhelloallyai',
        name: 'adminbughunterhelloallyai',
      });

      await reconcileWith({ headSha: 'abc1234def', mergeableState: 'behind' });

      expect(github.updatePullRequestBranch).toHaveBeenCalled();
    });

    it('still treats a GitHub App as its own', async () => {
      github.getCommitAuthor.mockResolvedValue({
        login: 'some-app[bot]',
        name: 'Some App',
      });

      await reconcileWith({ headSha: 'abc1234def', mergeableState: 'behind' });

      expect(github.updatePullRequestBranch).toHaveBeenCalled();
    });

    /**
     * Exact match, not a prefix: a person called `ally-builder-reviews` must
     * not quietly gain the right to have their pushes merged over.
     */
    it('does not claim a person whose name merely starts the same way', async () => {
      github.getCommitAuthor.mockResolvedValue({
        login: 'ally-builder-reviews',
        name: 'A Person',
      });

      await reconcileWith({ headSha: 'abc1234def', mergeableState: 'behind' });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
    });

    /** The other half of the same predicate: its own red CI is its to fix. */
    it('files its own failing check as pending work', async () => {
      github.getCommitAuthor.mockResolvedValue({
        login: 'adminbughunterhelloallyai',
        name: 'adminbughunterhelloallyai',
      });

      await reconcileWith({ headSha: 'abc1234def' }, openPr(), {
        state: 'failure',
        failed: ['Jest'],
      });

      expect(feedbackRepository.upsertIfNew).toHaveBeenCalledWith(
        expect.objectContaining({ status: BuilderPrFeedbackStatus.PENDING }),
      );
    });
  });
});
