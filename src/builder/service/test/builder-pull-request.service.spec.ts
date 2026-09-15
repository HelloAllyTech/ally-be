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
  let eventRepository: any;

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
      mergePullRequest: jest
        .fn()
        .mockResolvedValue({ merged: true, message: null }),
    };
    buildService = {
      dispatchFixRun: jest.fn().mockResolvedValue({ id: 'run-2' }),
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
});
