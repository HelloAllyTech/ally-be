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
  reviewPassedSha: null,
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
      // No release has failed its health check: automatic merges and
      // releases are not held.
      count: jest.fn().mockResolvedValue(0),
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
    sessionRepository = {
      findOne: jest.fn(),
      update: jest.fn(),
      // The outcome sweep runs first on every reconcile tick; nothing failed
      // by default.
      listRecentlyFailed: jest.fn().mockResolvedValue([]),
    };
    notificationService = {
      prsOpened: jest.fn(),
      releaseFailed: jest.fn(),
      releaseSkipped: jest.fn(),
      prReadyToMerge: jest.fn(),
      prMergedAutomatically: jest.fn(),
      prNeedsHuman: jest.fn(),
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
      // Healthy credential by default. A run of unauthorised calls is what
      // raises the alarm; zero failures keeps the release watcher quiet.
      credentialHealth: { failures: 0, since: null },
      listPullRequestFiles: jest
        .fn()
        .mockResolvedValue({ files: ['src/a.ts'], truncated: false }),
      getPullRequest: jest.fn(),
      getCheckRollup: jest.fn().mockResolvedValue(null),
      failedCheckExcerpts: jest.fn().mockResolvedValue({}),
      listPullRequestFeedback: jest.fn().mockResolvedValue([]),
      // Builder's own push by default: the ordinary case, and the one the
      // pre-existing CI tests below were written against.
      getCommitAuthor: jest.fn().mockResolvedValue({
        login: 'ally-builder[bot]',
        name: 'Ally Builder',
        // One parent: an ordinary commit, not a merge. The carry-forward path
        // is exercised by its own describe below.
        parents: ['parent00'],
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
      dispatchReviewRun: jest.fn().mockResolvedValue({ id: 'run-3' }),
      listActiveIssueRuns: jest.fn().mockResolvedValue([]),
      recentReviewOutcomes: jest.fn().mockResolvedValue([]),
      settleRun: jest.fn(),
      recordIssueFixRequest: jest.fn(),
      recordIssueMilestone: jest.fn(),
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

    service = new BuilderPullRequestService(
      repository,
      feedbackRepository,
      sessionRepository,
      notificationService,
      settingsService,
      github,
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

  describe('issue-dispatched builds', () => {
    const issueRun = (overrides: Record<string, unknown> = {}) => ({
      id: 'run-9',
      sessionId: 's1',
      repos: ['ally-be'],
      issueNumber: 7,
      issueUrl: 'https://github.com/o/ally-be/issues/7',
      dispatchedAt: new Date(),
      cost: null,
      ...overrides,
    });
    const opencodePr = {
      number: 12,
      htmlUrl: 'https://github.com/o/ally-be/pull/12',
      headRef: 'opencode/issue7-20261013141034',
      headSha: 'sha-1',
      title: 'Add promptHtml',
    };

    beforeEach(() => {
      github.listPullRequests = jest
        .fn()
        .mockResolvedValue([
          { number: 3, headRef: 'someone/else', headSha: 'x', htmlUrl: 'u' },
          opencodePr,
        ]);
      github.getCheckRollup = jest.fn();
      github.findRunSince = jest.fn().mockResolvedValue(null);
      github.createIssueComment = jest.fn().mockResolvedValue('url');
      jest.spyOn(service, 'recordFromRunner').mockResolvedValue([]);
    });

    it('records the PR opencode opened for the issue and settles the run when CI is green', async () => {
      buildService.listActiveIssueRuns.mockResolvedValue([issueRun()]);
      github.getCheckRollup.mockResolvedValue({
        state: 'success',
        failed: [],
        total: 2,
      });

      await service.reconcileOpenPullRequests();

      expect(service.recordFromRunner).toHaveBeenCalledWith('s1', 'run-9', [
        expect.objectContaining({
          repo: 'ally-be',
          prNumber: 12,
          branch: opencodePr.headRef,
        }),
      ]);
      expect(buildService.settleRun).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-9' }),
        'SUCCEEDED',
        null,
      );
      // The feed tells the story: PR opened, then CI passed.
      expect(
        buildService.recordIssueMilestone.mock.calls.map(
          (call: any[]) => call[1],
        ),
      ).toEqual(['pr:12', 'ci-pass:sha-1']);
    });

    it('asks opencode to fix red CI once per head commit, naming the failing checks', async () => {
      buildService.listActiveIssueRuns.mockResolvedValue([issueRun()]);
      github.getCheckRollup.mockResolvedValue({
        state: 'failure',
        failed: ['check'],
        total: 1,
      });

      await service.reconcileOpenPullRequests();

      expect(github.createIssueComment).toHaveBeenCalledWith(
        'ally-be',
        12,
        expect.stringMatching(/^\/oc CI failed on this pull request: check\./),
      );
      expect(buildService.recordIssueFixRequest).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-9' }),
        'sha-1',
      );

      // The same commit again: already asked, so nothing more is posted.
      github.createIssueComment.mockClear();
      buildService.listActiveIssueRuns.mockResolvedValue([
        issueRun({ cost: { issueFixRequests: ['sha-1'] } }),
      ]);
      await service.reconcileOpenPullRequests();
      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(buildService.settleRun).not.toHaveBeenCalled();
    });

    it('fails the build when fix requests run out', async () => {
      buildService.listActiveIssueRuns.mockResolvedValue([
        issueRun({ cost: { issueFixRequests: ['old-1', 'old-2'] } }),
      ]);
      github.getCheckRollup.mockResolvedValue({
        state: 'failure',
        failed: ['check'],
        total: 1,
      });

      await service.reconcileOpenPullRequests();

      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(buildService.settleRun).toHaveBeenCalledWith(
        expect.anything(),
        'FAILED',
        expect.stringMatching(/after 2 fix request/),
      );
    });

    it('fails the build when the workflow finished without a PR', async () => {
      github.listPullRequests.mockResolvedValue([]);
      github.findRunSince.mockResolvedValue({
        status: 'completed',
        htmlUrl: 'run-url',
      });
      buildService.listActiveIssueRuns.mockResolvedValue([issueRun()]);

      await service.reconcileOpenPullRequests();

      expect(service.recordFromRunner).not.toHaveBeenCalled();
      expect(buildService.settleRun).toHaveBeenCalledWith(
        expect.anything(),
        'FAILED',
        expect.stringMatching(/without opening a pull request/),
      );
    });

    it('waits while the workflow is still working', async () => {
      github.listPullRequests.mockResolvedValue([]);
      github.findRunSince.mockResolvedValue({
        status: 'in_progress',
        htmlUrl: 'run-url',
      });
      buildService.listActiveIssueRuns.mockResolvedValue([issueRun()]);

      await service.reconcileOpenPullRequests();

      expect(buildService.settleRun).not.toHaveBeenCalled();
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
        const fix = jest
          .spyOn(service as any, 'considerOpencodeFix')
          .mockResolvedValue(undefined);

        await reconcileWith({}, openPr({ branch: 'opencode/issue1-1' }), redCi);

        const [comment] = feedbackRepository.upsertIfNew.mock.calls.find(
          ([call]: [any]) => call.kind === BuilderPrFeedbackKind.REVIEW_COMMENT,
        );
        // No status passed at all, so `upsertIfNew` defaults it to PENDING —
        // the comment is ordinary work whoever else pushed.
        expect(comment).not.toHaveProperty('status');
        expect(fix).toHaveBeenCalled();
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
        github.createIssueComment = jest.fn().mockResolvedValue('url');

        await reconcileWith({}, openPr({ branch: 'opencode/issue1-1' }), redCi);

        // No `/oc` request: there is nothing pending to ask opencode about.
        expect(github.createIssueComment).not.toHaveBeenCalled();
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
    it("puts the failing step's output in its own failing check", async () => {
      github.failedCheckExcerpts.mockResolvedValue({
        'unit tests': 'FAIL src/a.spec.ts\n  expected 1, received 2',
      });

      await reconcileWith({}, openPr(), {
        state: 'failure',
        failed: ['unit tests'],
        total: 2,
      });

      const [row] = feedbackRepository.upsertIfNew.mock.calls.find(
        ([call]: [any]) => call.kind === BuilderPrFeedbackKind.CI_FAILURE,
      );
      expect(row.body).toContain('expected 1, received 2');
    });

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

      it('hands an opencode PR to a person with what the guard asked for', async () => {
        github.failedCheckExcerpts.mockResolvedValue({
          'docs-guard':
            '##[error]Changed libs/x.ts, described by repos/ally-web.md, but no Wiki-PR: trailer.',
        });

        await reconcileWith(
          {},
          openPr({ branch: 'opencode/issue9-1' }),
          docsRed,
        );

        const reason = repository.update.mock.calls
          .map(([, patch]: [any, any]) => patch.needsHumanReason)
          .find(Boolean);
        expect(reason).toContain('Needs a docs decision');
        expect(reason).toContain('repos/ally-web.md');
      });

      it('does not escalate a docs failure on a builder/* PR', async () => {
        await reconcileWith({}, openPr(), docsRed);

        expect(repository.update).not.toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ needsHumanReason: expect.any(String) }),
        );
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

  /**
   * An opencode pull request's feedback goes to opencode, as a `/oc` comment
   * carrying only a marker, not to a fix run on the old runner.
   */
  /**
   * Automation hands a pull request to a person when it stops converging,
   * rather than going quiet once a cap is reached.
   */
  describe('handing a pull request to a person', () => {
    const ocPr = (overrides: Record<string, any> = {}) =>
      openPr({
        branch: 'opencode/issue113-1',
        reviewedSha: 'head-3',
        reviewHistory: [],
        ...overrides,
      });
    const file = (pr: any, findings: { key: string; body: string }[]) => {
      repository.findOne.mockResolvedValue(pr);
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        title: 'x',
      });
      return service.recordReviewFindings(
        'review-run',
        'session-1',
        'pr-1',
        findings,
      );
    };
    const finding = (slug: string, sha = 'abc1234') => ({
      key: `${sha}:${slug}`,
      body: `[high] ${slug} breaks\n\nscenario`,
    });

    it('escalates when serious findings remain after the last fix round', async () => {
      await file(ocPr({ fixRunCount: 3 }), [finding('entities')]);

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanAt: expect.any(Date),
          needsHumanReason:
            'After 3 fix rounds, the latest review still found 1 problem.',
        }),
      );
      expect(notificationService.prNeedsHuman).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1' }),
        expect.objectContaining({ id: 'pr-1' }),
        'After 3 fix rounds, the latest review still found 1 problem.',
      );
    });

    it('escalates after two fix rounds in a row that did not reduce the findings', async () => {
      await file(
        ocPr({
          fixRunCount: 2,
          reviewHistory: [
            { sha: 'h1', count: 2, keys: ['a', 'b'] },
            { sha: 'h2', count: 2, keys: ['c', 'd'] },
          ],
        }),
        [finding('e'), finding('f'), finding('g')],
      );

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanReason:
            'Two fix rounds in a row did not reduce the problems the review found (still 3).',
        }),
      );
    });

    it('escalates when the same problem survives two fix rounds', async () => {
      await file(
        ocPr({
          fixRunCount: 2,
          reviewHistory: [
            { sha: 'h1', count: 3, keys: ['entities', 'x', 'y'] },
            { sha: 'h2', count: 2, keys: ['entities', 'z'] },
          ],
        }),
        [finding('entities', 'def5678')],
      );

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanReason:
            'The same problem survived two fix rounds: entities breaks',
        }),
      );
    });

    it('keeps going while the findings are coming down', async () => {
      await file(
        ocPr({
          fixRunCount: 1,
          reviewHistory: [{ sha: 'h1', count: 3, keys: ['a', 'b', 'c'] }],
        }),
        [finding('d')],
      );

      expect(notificationService.prNeedsHuman).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        {
          reviewHistory: [
            { sha: 'h1', count: 3, keys: ['a', 'b', 'c'] },
            { sha: 'head-3', count: 1, keys: ['d'], at: expect.any(String) },
          ],
        },
      );
    });

    it('escalates when CI or findings are still open and the rounds are spent', async () => {
      feedbackRepository.countPending.mockResolvedValue(2);
      github.createIssueComment = jest.fn();
      buildService.hasRunInFlight = jest.fn().mockResolvedValue(false);

      await reconcileWith({ headSha: 'head-3' }, ocPr({ fixRunCount: 3 }));

      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanReason: '3 fix rounds and 2 problems still open.',
        }),
      );
    });

    it('escalates when two reviews in a row ended without a verdict', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReviewEnabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      });
      buildService.recentReviewOutcomes.mockResolvedValue([
        'FAILED',
        'TIMED_OUT',
      ]);

      await reconcileWith(
        { headSha: 'head-4' },
        ocPr({ reviewRunCount: 2, reviewedSha: 'head-3' }),
        { state: 'success', failed: [], total: 3 },
      );

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanReason:
            'The last two reviews ended without a verdict, so I cannot tell whether this is safe.',
        }),
      );
    });

    it('does nothing automatic on a pull request waiting on a person', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReviewEnabled: true,
        autoFixEnabled: true,
        autoApproveEnabled: true,
        maxFixRunsPerPr: 3,
      });
      feedbackRepository.countPending.mockResolvedValue(1);

      await reconcileWith(
        { headSha: 'head-9' },
        ocPr({ needsHumanAt: new Date(), reviewedSha: 'head-3' }),
        { state: 'success', failed: [], total: 3 },
      );

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
      expect(github.approvePullRequest).not.toHaveBeenCalled();
    });

    it('escalates on the time box while waiting on opencode or CI', async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000).toISOString();
      feedbackRepository.countPending.mockResolvedValue(0);
      feedbackRepository.countActionable.mockResolvedValue(2);

      await reconcileWith(
        { headSha: 'head-4' },
        ocPr({
          fixRunCount: 1,
          reviewHistory: [
            { sha: 'h1', count: 2, keys: ['a', 'b'], at: fourHoursAgo },
          ],
        }),
      );

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanReason:
            '4 hours of automated review and fixes, and 2 problems are still open. Fixes were pushed after the last review and have not been reviewed yet.',
        }),
      );
      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('lets a clean pull request past the time box alone', async () => {
      const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000).toISOString();

      await reconcileWith(
        { headSha: 'head-4' },
        ocPr({
          reviewHistory: [
            { sha: 'h1', count: 2, keys: ['a'], at: fourHoursAgo },
            { sha: 'h2', count: 0, keys: [], at: fourHoursAgo },
          ],
        }),
      );

      expect(notificationService.prNeedsHuman).not.toHaveBeenCalled();
    });

    it('is not escalated, or announced, twice', async () => {
      await file(ocPr({ fixRunCount: 3, needsHumanAt: new Date() }), [
        finding('a'),
      ]);

      expect(notificationService.prNeedsHuman).not.toHaveBeenCalled();
    });

    it('resumes with a fresh budget, and records how the escalation ended', async () => {
      repository.findOne.mockResolvedValue(
        ocPr({
          needsHumanAt: new Date(),
          needsHumanReason: 'x',
          fixRunCount: 3,
        }),
      );
      repository.findOneOrFail.mockResolvedValue(ocPr());

      await service.resumeAutomation('session-1', 'pr-1', 7);

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanAt: null,
          needsHumanReason: null,
          escalationResolution: 'resumed',
          fixRunCount: 0,
          reviewRunCount: 0,
          reviewedSha: null,
          reviewHistory: [],
        }),
      );
    });

    it('refuses to resume a pull request from another session', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.resumeAutomation('session-2', 'pr-1', 7),
      ).rejects.toThrow(/not part of this session/);
    });
  });

  describe('after a release: the health check, and the brake it pulls', () => {
    const released = (overrides: Record<string, any> = {}) =>
      openPr({
        repo: 'ally-be',
        merged: true,
        releaseState: 'released',
        releaseTag: 'v1.2.3',
        releasedAt: new Date(Date.now() - 10 * 60_000),
        releaseHealthCheckedAt: null,
        ...overrides,
      });
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      (service as any).configService = {
        ...(service as any).configService,
        builderHealthUrls: { 'ally-be': 'https://api.example/api/health' },
      };
      notificationService.releaseFailed = jest.fn();
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        title: 'x',
      });
      fetchMock = jest.spyOn(global, 'fetch' as any);
      jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
        fn();
        return 0 as any;
      }) as any);
    });
    afterEach(() => jest.restoreAllMocks());

    it('marks a release unhealthy, says so, and stops the line', async () => {
      repository.find.mockResolvedValue([released()]);
      fetchMock.mockResolvedValue({ ok: false } as any);

      await service.checkReleaseHealth();

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          releaseState: 'unhealthy',
          releaseHealthCheckedAt: expect.any(Date),
        }),
      );
      expect(notificationService.releaseFailed).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1' }),
        'ally-be',
        42,
        'v1.2.3',
        expect.stringMatching(
          /health check is failing.*stopped automatic merges and releases/,
        ),
        null,
      );
    });

    it('records a healthy release and leaves it released', async () => {
      repository.find.mockResolvedValue([released()]);
      fetchMock.mockResolvedValue({ ok: true } as any);

      await service.checkReleaseHealth();

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        { releaseHealthCheckedAt: expect.any(Date) },
      );
      expect(notificationService.releaseFailed).not.toHaveBeenCalled();
    });

    it('waits for a fresh release to settle before checking it', async () => {
      repository.find.mockResolvedValue([released({ releasedAt: new Date() })]);

      await service.checkReleaseHealth();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('never calls a repo with no health URL healthy — it is not checked', async () => {
      repository.find.mockResolvedValue([released({ repo: 'ally-ai' })]);

      await service.checkReleaseHealth();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        { releaseHealthCheckedAt: expect.any(Date) },
      );
    });

    it('holds automatic merges while a recent release is unhealthy', async () => {
      repository.count.mockResolvedValue(1);

      await expect(service.releaseIsUnhealthy()).resolves.toBe(true);
    });
  });

  describe('what automation costs, and the per-PR spend limit', () => {
    it('adds a review or fix report to its pull request and session', async () => {
      repository.findOne.mockResolvedValue(
        openPr({
          id: 'pr-9',
          sessionId: 'session-7',
          automationCostUsd: '1.5',
        }),
      );
      buildService.recordExternalUsage = jest
        .fn()
        .mockResolvedValue('session-7');

      await service.recordUsage({
        kind: 'review',
        repo: 'ally-web',
        prNumber: 817,
        runId: 'review-run',
        costUsd: 2.25,
      });

      expect(repository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { repo: 'ally-web', prNumber: 817 } }),
      );
      expect(buildService.recordExternalUsage).toHaveBeenCalledWith(
        'review-run',
        'session-7',
        2.25,
      );
      expect(repository.increment).toHaveBeenCalledWith(
        { id: 'pr-9' },
        'automationCostUsd',
        2.25,
      );
    });

    it('counts a build report to its run and session, not a PR budget', async () => {
      buildService.recordExternalUsage = jest
        .fn()
        .mockResolvedValue('session-7');

      await service.recordUsage({
        kind: 'build',
        repo: 'ally-mobile',
        prNumber: null,
        runId: 'build-run',
        costUsd: 4,
      });

      expect(buildService.recordExternalUsage).toHaveBeenCalledWith(
        'build-run',
        null,
        4,
      );
      expect(repository.increment).not.toHaveBeenCalled();
    });

    it('hands a pull request to a person once its automation budget is spent', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReviewEnabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 2,
        maxPrAutomationUsd: '10',
      });
      feedbackRepository.countActionable.mockResolvedValue(2);
      sessionRepository.findOne.mockResolvedValue({
        id: 'session-1',
        title: 'x',
      });

      await reconcileWith(
        { headSha: 'head-3' },
        openPr({
          branch: 'opencode/issue1-1',
          automationCostUsd: '10.40',
          reviewedSha: 'head-2',
        }),
        { state: 'success', failed: [], total: 3 },
      );

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          needsHumanReason:
            'Spent $10.40 of the $10.00 automation budget on review and fixes, and 2 problems are still open. Fixes were pushed after the last review and have not been reviewed yet.',
        }),
      );
    });

    it('keeps going under the budget', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReviewEnabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 2,
        maxPrAutomationUsd: '10',
      });

      await reconcileWith(
        { headSha: 'head-3' },
        openPr({
          branch: 'opencode/issue1-1',
          automationCostUsd: '3.10',
          reviewedSha: 'head-2',
        }),
        { state: 'success', failed: [], total: 3 },
      );

      expect(buildService.dispatchReviewRun).toHaveBeenCalled();
    });
  });

  describe('the track record', () => {
    it('counts clean reviews, merges as reviewed, escalations and unhealthy releases', async () => {
      const pr = (o: Record<string, any>) =>
        openPr({
          branch: 'opencode/i-1',
          reviewHistory: [{ sha: 'a', count: 0, keys: [] }],
          ...o,
        });
      repository.find.mockResolvedValue([
        pr({ reviewPassedSha: 'h1', headSha: 'h1', merged: true }),
        pr({ reviewPassedSha: 'h2', headSha: 'h3', merged: true }),
        pr({ needsHumanAt: new Date() }),
        pr({
          reviewPassedSha: 'h4',
          headSha: 'h4',
          merged: true,
          releaseState: 'unhealthy',
        }),
        openPr({ branch: 'opencode/i-2', reviewHistory: null }),
      ]);

      await expect(service.trackRecord(10)).resolves.toEqual({
        window: 10,
        cleanReviewed: 3,
        mergedAsReviewed: 2,
        escalated: 1,
        unhealthyReleases: 1,
      });
    });
  });

  describe('the review cap', () => {
    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoReviewEnabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      });
    });

    it('lets an opencode PR be reviewed after each fix round, up to its own cap', async () => {
      await reconcileWith(
        { headSha: 'head-3' },
        openPr({
          branch: 'opencode/issue1-1',
          reviewRunCount: 2,
          reviewedSha: 'head-2',
        }),
        { state: 'success', failed: [], total: 3 },
      );
      expect(buildService.dispatchReviewRun).toHaveBeenCalled();

      buildService.dispatchReviewRun.mockClear();
      await reconcileWith(
        { headSha: 'head-5' },
        openPr({
          branch: 'opencode/issue1-1',
          reviewRunCount: 4,
          reviewedSha: 'head-4',
        }),
        { state: 'success', failed: [], total: 3 },
      );
      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    /** A builder/* PR from Builder's old runner build has no review left. */
    it('never reviews a builder/ pull request', async () => {
      await reconcileWith(
        { headSha: 'head-1' },
        openPr({ reviewRunCount: 0 }),
        { state: 'success', failed: [], total: 3 },
      );
      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });
  });

  describe('feedback on an opencode pull request', () => {
    const ocPr = (overrides: Record<string, any> = {}) =>
      openPr({ branch: 'opencode/issue113-20261014085905', ...overrides });
    const finding = {
      id: 'fb-1',
      kind: 'agent_review',
      status: 'pending',
      author: 'builder-review',
      body: 'promptHtml is not sanitized before render.',
      path: 'src/journal.tsx',
      line: 12,
    };

    beforeEach(() => {
      github.createIssueComment = jest
        .fn()
        .mockResolvedValue('https://github.com/org/ally-be/pull/42#c1');
      github.findRunSince = jest.fn().mockResolvedValue(null);
      buildService.hasRunInFlight = jest.fn().mockResolvedValue(false);
    });

    it('asks opencode with a marker-only /oc comment instead of a fix run', async () => {
      feedbackRepository.countPending.mockResolvedValue(1);
      feedbackRepository.listActionable.mockResolvedValue([finding]);

      await reconcileWith({ headSha: 'head-1' }, ocPr());
      const [repo, number, body] = github.createIssueComment.mock.calls[0];
      expect([repo, number]).toEqual(['ally-be', 42]);
      expect(body).toMatch(/^\/oc /);
      expect(body).toContain('<!-- builder-feedback: pr-1 -->');
      // ally-be, ally-web and ally-ai are public: the finding stays private.
      expect(body).not.toContain('sanitized');
      expect(feedbackRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        expect.objectContaining({
          status: 'in_fix',
          fixRunId: null,
          replyUrl: 'https://github.com/org/ally-be/pull/42#c1',
        }),
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          fixRunCount: 1,
          fixRequestedSha: 'head-1',
          fixRequestedAt: expect.any(Date),
        }),
      );
    });

    it('leaves red CI to the issue build while that run is in flight', async () => {
      feedbackRepository.countPending.mockResolvedValue(1);
      buildService.hasRunInFlight.mockResolvedValue(true);

      await reconcileWith({ headSha: 'head-1' }, ocPr());

      expect(github.createIssueComment).not.toHaveBeenCalled();
    });

    it('respects the per-PR ceiling and the autoFix switch', async () => {
      feedbackRepository.countPending.mockResolvedValue(1);
      await reconcileWith({ headSha: 'head-1' }, ocPr({ fixRunCount: 3 }));
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: false,
        maxFixRunsPerPr: 3,
      });
      await reconcileWith({ headSha: 'head-1' }, ocPr());

      expect(github.createIssueComment).not.toHaveBeenCalled();
    });

    it('marks the feedback addressed once opencode moves the branch', async () => {
      await reconcileWith(
        { headSha: 'head-2' },
        ocPr({ fixRequestedSha: 'head-1', fixRequestedAt: new Date() }),
      );

      expect(feedbackRepository.update).toHaveBeenCalledWith(
        { pullRequestId: 'pr-1', status: 'in_fix' },
        expect.objectContaining({ status: 'addressed' }),
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        { fixRequestedSha: null, fixRequestedAt: null },
      );
      expect(github.createIssueComment).not.toHaveBeenCalled();
    });

    it('puts it back to pending when opencode finished without pushing anything', async () => {
      github.findRunSince.mockResolvedValue({
        id: '9',
        status: 'completed',
        conclusion: 'success',
      });

      await reconcileWith(
        { headSha: 'head-1' },
        ocPr({ fixRequestedSha: 'head-1', fixRequestedAt: new Date() }),
      );

      expect(github.findRunSince).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow: 'builder.yml',
          event: 'issue_comment',
        }),
      );
      expect(feedbackRepository.update).toHaveBeenCalledWith(
        { pullRequestId: 'pr-1', status: 'in_fix' },
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('waits while opencode is still working, then retries after the timeout', async () => {
      github.findRunSince.mockResolvedValue({ id: '9', status: 'in_progress' });
      await reconcileWith(
        { headSha: 'head-1' },
        ocPr({ fixRequestedSha: 'head-1', fixRequestedAt: new Date() }),
      );
      expect(feedbackRepository.update).not.toHaveBeenCalledWith(
        { pullRequestId: 'pr-1', status: 'in_fix' },
        expect.anything(),
      );

      github.findRunSince.mockResolvedValue(null);
      await reconcileWith(
        { headSha: 'head-1' },
        ocPr({
          fixRequestedSha: 'head-1',
          fixRequestedAt: new Date(Date.now() - 61 * 60_000),
        }),
      );
      expect(feedbackRepository.update).toHaveBeenCalledWith(
        { pullRequestId: 'pr-1', status: 'in_fix' },
        { status: 'pending' },
      );
    });

    /**
     * Builder's old runner only drafts designs now, so feedback on a
     * builder/* PR it left waits for a person.
     */
    it('leaves a builder/ branch alone', async () => {
      feedbackRepository.countPending.mockResolvedValue(1);

      await reconcileWith({ headSha: 'head-1' }, openPr());

      expect(github.createIssueComment).not.toHaveBeenCalled();
    });

    it('hands the workflow the claimed feedback as its prompt', async () => {
      repository.findOne.mockResolvedValue(ocPr());
      feedbackRepository.listActionable.mockResolvedValue([
        { ...finding, status: 'in_fix' },
        {
          id: 'fb-2',
          kind: 'ci_failure',
          status: 'in_fix',
          body: 'The check "Jest" failed on head-1.',
        },
        {
          id: 'fb-3',
          kind: 'review_comment',
          status: 'pending',
          body: 'later',
        },
      ]);

      const prompt = await service.fixRequestPrompt('pr-1');

      expect(prompt).toContain('pull request #42');
      expect(prompt).toContain(
        '1. Review finding (src/journal.tsx:12):\npromptHtml is not sanitized before render.',
      );
      expect(prompt).toContain('2. Failing check:\nThe check "Jest" failed');
      // Only what the outstanding request claimed.
      expect(prompt).not.toContain('later');
    });

    it('404s for a pull request Builder does not know', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.fixRequestPrompt('nope')).rejects.toThrow(
        /No Builder pull request/,
      );
    });
  });

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
    // Only opencode pull requests are reviewed.
    const ocPr = (overrides: Record<string, any> = {}) =>
      openPr({ branch: 'opencode/issue1-1', ...overrides });

    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        autoReviewEnabled: true,
        maxFixRunsPerPr: 3,
      });
    });

    it('reviews a green pull request it has not read yet', async () => {
      const pr = ocPr();
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

      await reconcileWith({ headSha: 'abc1234def' }, ocPr(), green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('does not re-read a head sha it has already reviewed', async () => {
      const pr = ocPr({ reviewedSha: 'abc1234def', reviewRunCount: 1 });
      await reconcileWith({ headSha: 'abc1234def' }, pr, green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('reviews again once a fix run has moved the branch on', async () => {
      const pr = ocPr({ reviewedSha: 'oldsha11', reviewRunCount: 1 });
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
      await reconcileWith({ headSha: 'abc1234def' }, ocPr(), {
        state: 'failure',
        failed: ['Jest'],
      });

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('waits rather than racing checks that are still running', async () => {
      await reconcileWith({ headSha: 'abc1234def' }, ocPr(), {
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
      const pr = ocPr({ reviewRunCount: 4, reviewedSha: 'oldsha11' });
      await reconcileWith({ headSha: 'newsha22' }, pr, green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    it('waits while there is feedback a fix run has not dealt with', async () => {
      feedbackRepository.countPending.mockResolvedValue(1);

      await reconcileWith({ headSha: 'abc1234def' }, ocPr(), green);

      expect(buildService.dispatchReviewRun).not.toHaveBeenCalled();
    });

    /**
     * A review leaves an active run behind, and a fix must not race it — so
     * asking for both in a tick gets the second refused and reads as a bug
     * from the outside.
     */
    it('does not also ask for a fix in the same tick', async () => {
      const fix = jest
        .spyOn(service as any, 'considerOpencodeFix')
        .mockResolvedValue(undefined);
      feedbackRepository.countPending.mockResolvedValue(0);

      await reconcileWith({ headSha: 'abc1234def' }, ocPr(), green);

      expect(buildService.dispatchReviewRun).toHaveBeenCalled();
      expect(fix).not.toHaveBeenCalled();
    });

    /**
     * When the reviewer declines (budget, concurrency, an in-flight run), the
     * tick must fall through rather than skip the fix loop on the strength of
     * a review that never happened.
     */
    it('still considers a fix when the review was refused', async () => {
      const fix = jest
        .spyOn(service as any, 'considerOpencodeFix')
        .mockResolvedValue(undefined);
      buildService.dispatchReviewRun.mockResolvedValue(null);
      feedbackRepository.countPending
        .mockResolvedValueOnce(0)
        .mockResolvedValue(1);

      await reconcileWith({ headSha: 'abc1234def' }, ocPr(), green);

      expect(fix).toHaveBeenCalled();
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
      // The state a review run leaves behind: `dispatchReviewRun` stamps
      // `reviewedSha` with the head it is about to read, so by the time
      // findings come back the row says which commit was reviewed. The
      // approval guard reads exactly that, so the fixture has to carry it.
      repository.findOne.mockResolvedValue(
        openPr({
          headSha: 'abc1234def',
          reviewedSha: 'abc1234def',
          reviewPassedSha: 'abc1234def',
        }),
      );
      github.getPullRequest.mockResolvedValue({
        state: 'open',
        merged: false,
        headSha: 'abc1234def',
        mergedAt: null,
        htmlUrl: 'https://github.com/o/ally-be/pull/42',
      });
      github.getCheckRollup.mockResolvedValue(green);
    });

    /**
     * Somebody pushed while the review was reading. The findings describe code
     * that is no longer at the head, so approving would put a machine's name on
     * a commit nothing has read — the one thing an auto-approver must never do.
     */
    it('does not approve when a commit landed during the review', async () => {
      repository.findOne.mockResolvedValue(
        openPr({
          headSha: 'abc1234def',
          reviewedSha: 'an-older-commit',
          reviewPassedSha: 'an-older-commit',
        }),
      );

      await service.recordReviewFindings('run-3', 'session-1', 'pr-1', []);

      expect(github.approvePullRequest).not.toHaveBeenCalled();
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
  /**
   * The last click, taken by the machine.
   *
   * Every one of these pins a fact that has to be re-established against the
   * CURRENT head rather than inherited from whenever the review ran — the
   * failure this guards against is merging a commit nothing has read, which
   * is the one mistake an auto-merger cannot apologise for.
   */
  describe('merging on a clean review', () => {
    const green = { state: 'success', failed: [] };
    const reviewed = (over: Record<string, any> = {}) =>
      openPr({
        headSha: 'abc1234def',
        reviewedSha: 'abc1234def',
        reviewPassedSha: 'abc1234def',
        title: 'Add a thing',
        ...over,
      });

    const on = (over: Record<string, any> = {}) => ({
      enabled: true,
      autoFixEnabled: true,
      autoReviewEnabled: true,
      autoApproveEnabled: true,
      autoMergeEnabled: true,
      autoReleaseEnabled: false,
      maxFixRunsPerPr: 3,
      ...over,
    });

    beforeEach(() => {
      settingsService.get.mockResolvedValue(on());
      sessionRepository.findOne.mockResolvedValue({ id: 'session-1' });
      // `mergePullRequest` re-reads the row after updating it and returns what
      // it finds, so a static mock would hand back a row still saying
      // `merged: false` and the announcement guard would — correctly — refuse
      // to announce a merge the row does not claim. The fixture has to move
      // the way the table does.
      let merged = false;
      repository.update.mockImplementation((_: any, patch: any) => {
        if (patch?.merged) merged = true;
        return Promise.resolve(undefined);
      });
      repository.findOne.mockImplementation(() =>
        Promise.resolve(reviewed({ merged })),
      );
    });

    const tick = (over: Record<string, any> = {}, pr = reviewed()) =>
      reconcileWith(
        { headSha: 'abc1234def', mergeableState: 'clean', ...over },
        pr,
        green,
      );

    it('merges a green pull request its own review passed', async () => {
      await tick();

      expect(github.mergePullRequest).toHaveBeenCalledWith(
        'ally-be',
        42,
        'Add a thing',
      );
    });

    it('stays off unless auto-merge is explicitly enabled', async () => {
      settingsService.get.mockResolvedValue(on({ autoMergeEnabled: false }));

      await tick();

      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    /**
     * `reviewedSha` says a review was DISPATCHED at that commit; only
     * `reviewPassedSha` says one came back clean. A run that failed stamps the
     * first without earning the second, and merging on it would ship a diff
     * whose review never finished.
     */
    it('will not merge on a review that was only attempted', async () => {
      const attempted = openPr({
        headSha: 'abc1234def',
        reviewedSha: 'abc1234def',
        reviewPassedSha: null,
      });
      repository.findOne.mockResolvedValue(attempted);

      await tick({}, attempted);

      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    /** Somebody pushed while the review was reading. */
    it('will not merge a commit the clean review never read', async () => {
      const moved = openPr({
        headSha: 'abc1234def',
        reviewedSha: 'an-older-commit',
        reviewPassedSha: 'an-older-commit',
      });
      repository.findOne.mockResolvedValue(moved);

      await tick({}, moved);

      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    /** A finding a fix run has not finished with means the diff will change. */
    it('will not merge with anything actionable outstanding', async () => {
      feedbackRepository.countActionable.mockResolvedValue(1);

      await tick();

      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    /** GitHub's own answer to "is anything still in the way". */
    it('defers to mergeable_state rather than recomputing it', async () => {
      await tick({ mergeableState: 'blocked' });

      expect(github.mergePullRequest).not.toHaveBeenCalled();
    });

    /**
     * The graceful-degradation half. A decline must not be silent: the work
     * stops in front of a person, which is what the button is for.
     */
    it('falls back to the human merge button when it declines', async () => {
      settingsService.get.mockResolvedValue(on({ autoMergeEnabled: false }));

      await tick();

      expect(notificationService.prReadyToMerge).toHaveBeenCalled();
    });

    it('does not also offer a button for something it just merged', async () => {
      await tick();

      expect(notificationService.prMergedAutomatically).toHaveBeenCalled();
      expect(notificationService.prReadyToMerge).not.toHaveBeenCalled();
    });

    /**
     * A refusal between the rollup and the merge — a check gone red, a base
     * that moved — is expected traffic on a five-minute tick, not an incident.
     * Throwing would abort the pass for every pull request behind this one.
     */
    it('swallows a refusal and still offers the button', async () => {
      github.mergePullRequest.mockResolvedValue({
        merged: false,
        message: 'Base branch was modified.',
      });

      await tick();

      expect(notificationService.prMergedAutomatically).not.toHaveBeenCalled();
      expect(notificationService.prReadyToMerge).toHaveBeenCalled();
    });

    /** What a reader acts on differs, so the sentence differs. */
    it('says whether a release is on the way', async () => {
      settingsService.get.mockResolvedValue(on({ autoReleaseEnabled: true }));

      await tick();

      expect(notificationService.prMergedAutomatically).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ prNumber: 42 }),
        true,
      );
    });
  });

  describe('a pull request that conflicts with master', () => {
    const dirty = { headSha: 'abc1234def', mergeableState: 'dirty' };
    const opencodePr = (overrides: Record<string, any> = {}) =>
      openPr({ branch: 'opencode/issue1-thing', ...overrides });

    beforeEach(() => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: true,
        maxFixRunsPerPr: 2,
      });
      github.createIssueComment = jest.fn().mockResolvedValue('url');
      buildService.hasRunInFlight = jest.fn().mockResolvedValue(false);
      sessionRepository.findOne.mockResolvedValue({ id: 'session-1' });
    });

    /** No CI runs on a conflicting PR, so waiting for it never ends. */
    it('asks opencode to resolve it and counts the round', async () => {
      await reconcileWith(dirty, opencodePr());

      expect(github.createIssueComment).toHaveBeenCalledWith(
        'ally-be',
        42,
        expect.stringContaining('/oc This pull request conflicts with master'),
      );
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'pr-1' },
        expect.objectContaining({
          fixRunCount: 1,
          fixRequestedSha: 'abc1234def',
        }),
      );
    });

    it('does not ask again while a request is outstanding', async () => {
      await reconcileWith(
        dirty,
        opencodePr({
          fixRequestedAt: new Date(),
          fixRequestedSha: 'abc1234def',
        }),
      );

      expect(github.createIssueComment).not.toHaveBeenCalled();
    });

    it('hands it to a person once the rounds are spent', async () => {
      await reconcileWith(dirty, opencodePr({ fixRunCount: 2 }));

      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(notificationService.prNeedsHuman).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('conflicts with master'),
      );
    });

    it('hands it to a person when automatic fixes are off', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: false,
        maxFixRunsPerPr: 2,
      });

      await reconcileWith(dirty, opencodePr());

      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(notificationService.prNeedsHuman).toHaveBeenCalled();
    });

    it('hands it to a person when somebody else pushed last', async () => {
      github.getCommitAuthor.mockResolvedValue({
        login: 'a-person',
        name: 'A Person',
      });

      await reconcileWith(dirty, opencodePr());

      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(notificationService.prNeedsHuman).toHaveBeenCalled();
    });

    it('hands over a conflicted branch opencode did not make', async () => {
      await reconcileWith(dirty, openPr());

      expect(github.createIssueComment).not.toHaveBeenCalled();
      expect(notificationService.prNeedsHuman).toHaveBeenCalled();
    });
  });

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
     * The setting this actually ran into.
     *
     * This used to be gated on `autoFixEnabled`, which conflated two different
     * things: spending money on agent runs, and a single GitHub API call that
     * merges master in. Running with review on and fix off — the deliberate
     * "don't spend, just tell me" setting — therefore left green, approved pull
     * requests parked at `behind`, which is not `clean`, which is what the
     * merge prompt waits for. The loop went quiet with nothing to click.
     */
    it('keeps the branch current even with auto-fix switched off', async () => {
      settingsService.get.mockResolvedValue({
        enabled: true,
        autoFixEnabled: false,
        autoReviewEnabled: true,
        maxFixRunsPerPr: 3,
      });

      await reconcileWith({ headSha: 'abc1234def', ...behind });

      expect(github.updatePullRequestBranch).toHaveBeenCalledWith(
        'ally-be',
        42,
        'abc1234def',
      );
    });

    /** The kill switch still means everything off. */
    it('stops when the kill switch is off', async () => {
      settingsService.get.mockResolvedValue({
        enabled: false,
        autoFixEnabled: true,
        maxFixRunsPerPr: 3,
      });

      await reconcileWith({ headSha: 'abc1234def', ...behind });

      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
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

/**
 * Approval is a policy, not an event.
 *
 * It used to be reachable from exactly one place — the moment a review run
 * recorded zero findings — which quietly made `autoApproveEnabled` mean "approve
 * reviews that finish from now on" rather than "approve clean reviews". A pull
 * request reviewed while the switch was off could never be approved afterwards:
 * the review cap refuses a second review, so the one event that could have
 * approved it was never going to happen again. ally-web#658 sat in that state.
 *
 * So it is reconsidered on the reconcile tick against a durable fact — this
 * commit was reviewed clean — and stamped per-sha, because the approve call
 * posts a new review every time it is made.
 */
describe('BuilderPullRequestService — approval on the reconcile tick', () => {
  let service: any;
  let repository: any;
  let github: any;
  let settings: any;
  let feedbackRepository: any;

  const HEAD = 'abc1234def';

  beforeEach(() => {
    repository = { update: jest.fn() };
    feedbackRepository = { countActionable: jest.fn().mockResolvedValue(0) };
    github = {
      getPullRequest: jest.fn(),
      getCheckRollup: jest.fn(),
      failedCheckExcerpts: jest.fn().mockResolvedValue({}),
      // An ordinary commit by default: no merge lineage to carry a review
      // across, so these cases exercise the plain reviewed-this-sha path.
      getCommitAuthor: jest.fn().mockResolvedValue({
        login: 'ally-builder[bot]',
        name: null,
        parents: ['x'],
      }),
      approvePullRequest: jest
        .fn()
        .mockResolvedValue({ approved: true, message: null }),
    };
    settings = { enabled: true, autoApproveEnabled: true };

    service = Object.create(BuilderPullRequestService.prototype);
    Object.assign(service, {
      repository,
      feedbackRepository,
      github,
      settingsService: { get: jest.fn(() => Promise.resolve(settings)) },
      logger: { info: jest.fn(), warn: jest.fn() },
    });
  });

  const pr = (overrides: Record<string, any> = {}) => ({
    id: 'pr-1',
    repo: 'ally-web',
    prNumber: 658,
    headSha: HEAD,
    reviewedSha: HEAD,
    reviewPassedSha: HEAD,
    approvedSha: null,
    ...overrides,
  });

  const known = (overrides: Record<string, any> = {}) => ({
    remote: { state: 'open', merged: false, headSha: HEAD, ...overrides },
    rollup: { state: 'success' },
  });

  it('approves a PR reviewed clean while the switch was off', async () => {
    await service.considerApproval(pr(), known());

    expect(github.approvePullRequest).toHaveBeenCalledWith(
      'ally-web',
      658,
      expect.stringContaining('Builder'),
    );
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'pr-1' },
      { approvedSha: HEAD },
    );
  });

  /**
   * The stamp is the whole reason this is safe to run on a tick: without it a
   * pull request would collect one approval every few minutes forever.
   */
  it('does not approve the same commit twice', async () => {
    await service.considerApproval(pr({ approvedSha: HEAD }), known());

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  /** A new push re-opens the question — that is what approving a commit means. */
  it('approves again once a new commit is reviewed', async () => {
    await service.considerApproval(
      pr({
        approvedSha: 'older-sha',
        headSha: 'new-sha',
        reviewedSha: 'new-sha',
        reviewPassedSha: 'new-sha',
      }),
      known({ headSha: 'new-sha' }),
    );

    expect(github.approvePullRequest).toHaveBeenCalled();
  });

  it('never approves a commit no review has read', async () => {
    await service.considerApproval(
      pr({
        reviewedSha: 'an-older-commit',
        reviewPassedSha: 'an-older-commit',
      }),
      known(),
    );

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it('never approves a pull request that has never been reviewed', async () => {
    await service.considerApproval(
      pr({ reviewedSha: null, reviewPassedSha: null }),
      known(),
    );

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it('waits for outstanding feedback to be dealt with', async () => {
    feedbackRepository.countActionable.mockResolvedValue(1);

    await service.considerApproval(pr(), known());

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it('does not approve over red checks', async () => {
    await service.considerApproval(pr(), {
      remote: { state: 'open', merged: false, headSha: HEAD },
      rollup: { state: 'failure' },
    });

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it('stays off when the switch is off', async () => {
    settings.autoApproveEnabled = false;

    await service.considerApproval(pr(), known());

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  /**
   * The reconcile pass has already fetched both of these for this tick.
   * Re-fetching would double this service's GitHub traffic across every open
   * pull request to learn what the caller already knows.
   */
  it('reuses the caller pull request and rollup rather than refetching', async () => {
    await service.considerApproval(pr(), known());

    expect(github.getPullRequest).not.toHaveBeenCalled();
    expect(github.getCheckRollup).not.toHaveBeenCalled();
  });

  /**
   * An already-approved pull request is the common case on a tick, so it must
   * not cost a network round trip to discover that.
   */
  it('short-circuits an approved PR before any network call', async () => {
    await service.considerApproval(pr({ approvedSha: HEAD }), undefined);

    expect(github.getPullRequest).not.toHaveBeenCalled();
  });
});

/**
 * Surviving our own branch update.
 *
 * Both repos protect master with `dismiss_stale_reviews` AND
 * `strict_up_to_date`, which together form a closed loop: a pull request must be
 * current with master to merge, bringing it current pushes a commit, and that
 * commit dismisses the approval. Re-approving needs a review of the new head,
 * the per-PR cap refuses one after two, and the pull request is then stuck for
 * good — green, reviewed, unapprovable, unmergeable. ally-web#658 was one branch
 * update away from exactly that.
 */
describe('BuilderPullRequestService — carrying a review across our own update', () => {
  const REVIEWED = 'reviewed0';
  const MERGED_HEAD = 'mergehead';

  let service: any;
  let repository: any;
  let github: any;
  let settings: any;

  beforeEach(() => {
    repository = { update: jest.fn() };
    settings = { enabled: true, autoApproveEnabled: true };
    github = {
      getCommitAuthor: jest.fn(),
      getPullRequest: jest.fn(),
      getCheckRollup: jest.fn(),
      failedCheckExcerpts: jest.fn().mockResolvedValue({}),
      approvePullRequest: jest
        .fn()
        .mockResolvedValue({ approved: true, message: null }),
    };
    service = Object.create(BuilderPullRequestService.prototype);
    Object.assign(service, {
      repository,
      feedbackRepository: { countActionable: jest.fn().mockResolvedValue(0) },
      github,
      settingsService: { get: jest.fn(() => Promise.resolve(settings)) },
      logger: { info: jest.fn(), warn: jest.fn() },
    });
  });

  const pr = (overrides: Record<string, any> = {}) => ({
    id: 'pr-1',
    repo: 'ally-web',
    prNumber: 658,
    headSha: MERGED_HEAD,
    reviewedSha: REVIEWED,
    reviewPassedSha: REVIEWED,
    approvedSha: null,
    ...overrides,
  });

  const known = {
    remote: { state: 'open', merged: false, headSha: MERGED_HEAD },
    rollup: { state: 'success' },
  };

  /** The merge master left behind: our commit, reviewed head as first parent. */
  const ourMerge = {
    login: 'ally-builder[bot]',
    name: 'Ally Builder',
    parents: [REVIEWED, 'master00'],
  };

  it('approves the merge commit its own update created', async () => {
    github.getCommitAuthor.mockResolvedValue(ourMerge);

    await service.considerApproval(pr(), known);

    expect(github.approvePullRequest).toHaveBeenCalled();
    // Stamped forward, so the next tick short-circuits instead of re-deriving.
    // The PASS moves, not the dispatch: carrying `reviewedSha` would say a
    // review ran against this merge commit, which is not what happened.
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'pr-1' },
      { reviewPassedSha: MERGED_HEAD },
    );
  });

  /**
   * First parent specifically. On a merge commit the first parent is the branch
   * being merged INTO; accepting either parent would also accept the reverse
   * merge, which is a different commit with different contents.
   */
  it('refuses a merge whose reviewed head is only the second parent', async () => {
    github.getCommitAuthor.mockResolvedValue({
      ...ourMerge,
      parents: ['master00', REVIEWED],
    });

    await service.considerApproval(pr(), known);

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  /** A single-parent commit is real work, and real work needs a real review. */
  it('refuses an ordinary commit pushed on top of the reviewed head', async () => {
    github.getCommitAuthor.mockResolvedValue({
      ...ourMerge,
      parents: [REVIEWED],
    });

    await service.considerApproval(pr(), known);

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  /** Somebody else merging master in is not our update to vouch for. */
  it('refuses a merge somebody else made', async () => {
    github.getCommitAuthor.mockResolvedValue({
      login: 'a-person',
      name: 'A Person',
      parents: [REVIEWED, 'master00'],
    });

    await service.considerApproval(pr(), known);

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  /**
   * The carry-forward says the diff is unchanged, not that it still works.
   * A semantic conflict dragged in from master is CI's to catch, and approval
   * still waits for green.
   */
  it('still refuses to approve over red checks', async () => {
    github.getCommitAuthor.mockResolvedValue(ourMerge);

    await service.considerApproval(pr(), {
      remote: known.remote,
      rollup: { state: 'failure' },
    });

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it('does not reach for the commit when the head is already the reviewed one', async () => {
    await service.considerApproval(
      pr({
        headSha: REVIEWED,
        reviewedSha: REVIEWED,
        reviewPassedSha: REVIEWED,
      }),
      { remote: { ...known.remote, headSha: REVIEWED }, rollup: known.rollup },
    );

    expect(github.getCommitAuthor).not.toHaveBeenCalled();
    expect(github.approvePullRequest).toHaveBeenCalled();
  });
});

/**
 * The banner that would not go away.
 *
 * `settleRun` writes a failed run's error onto the run AND the session, and only
 * a new dispatch clears the session copy. Fine while runs keep coming; not fine
 * when they cannot. A session over budget, parked on a question, or blocked on a
 * dead credential has no next dispatch, so the banner stays forever.
 *
 * Which would be untidy if the text were vague. It is not: the gate error says
 * "nothing proves the change works" while sitting above pull requests whose
 * every required check is green. The page states the opposite of the evidence.
 */
describe('BuilderPullRequestService — clearing an error the PRs disproved', () => {
  let service: any;
  let sessionRepository: any;
  let repository: any;
  let feedbackRepository: any;

  const green = (over: Record<string, any> = {}) => ({
    id: 'pr-1',
    merged: false,
    state: 'open',
    ciStatus: 'success',
    ...over,
  });

  beforeEach(() => {
    sessionRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 's-1', error: 'gate failed' }),
      update: jest.fn(),
    };
    repository = { listBySession: jest.fn().mockResolvedValue([green()]) };
    feedbackRepository = { countActionable: jest.fn().mockResolvedValue(0) };

    service = Object.create(BuilderPullRequestService.prototype);
    Object.assign(service, {
      sessionRepository,
      repository,
      feedbackRepository,
      logger: { info: jest.fn(), warn: jest.fn() },
    });
  });

  it('clears it once every open pull request is green', async () => {
    await service.clearStaleSessionError('s-1');

    expect(sessionRepository.update).toHaveBeenCalledWith(
      { id: 's-1' },
      { error: null },
    );
  });

  it('leaves it alone while a pull request is red', async () => {
    repository.listBySession.mockResolvedValue([
      green(),
      green({ id: 'pr-2', ciStatus: 'failure' }),
    ]);

    await service.clearStaleSessionError('s-1');

    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  /** Unread checks are not passed checks. */
  it('leaves it alone when a pull request has no CI verdict yet', async () => {
    repository.listBySession.mockResolvedValue([green({ ciStatus: null })]);

    await service.clearStaleSessionError('s-1');

    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  it('leaves it alone while there is feedback still to act on', async () => {
    feedbackRepository.countActionable.mockResolvedValue(1);

    await service.clearStaleSessionError('s-1');

    expect(sessionRepository.update).not.toHaveBeenCalled();
  });

  /**
   * This previously asserted the opposite, on the reasoning that a session with
   * nothing open has "no evidence either way". That was wrong: a MERGED pull
   * request is the strongest evidence available — green checks plus a person
   * explicitly choosing to take the change. Only a pull request closed WITHOUT
   * merging is a rejection, and that case is asserted separately.
   */
  it('clears once the pull requests have merged', async () => {
    repository.listBySession.mockResolvedValue([
      green({ merged: true, state: 'closed' }),
    ]);

    await service.clearStaleSessionError('s-1');

    expect(sessionRepository.update).toHaveBeenCalledWith(
      { id: 's-1' },
      { error: null },
    );
  });

  /**
   * The method now reconciles the STATUS as well as the error, so a session
   * with nothing wrong still gets looked at — it just must not be written to.
   */
  it('writes nothing to a session that has no error and has not failed', async () => {
    sessionRepository.findOne.mockResolvedValue({
      id: 's-1',
      error: null,
      status: 'COMPLETED',
    });

    await service.clearStaleSessionError('s-1');

    expect(sessionRepository.update).not.toHaveBeenCalled();
  });
});

/**
 * A dispatched review is not a passed review.
 *
 * `reviewedSha` is stamped at DISPATCH, by design — reconcile needs to know a
 * review is already in flight for a head so it does not start a second one.
 * Approval used to be reachable only from a review that had just finished
 * reporting zero findings, so it never had to care about the difference.
 *
 * Moving approval onto the reconcile tick quietly repurposed `reviewedSha` as
 * evidence of a clean review, which it has never been. ally-be#494 is the case
 * that makes it concrete: three review runs, all FAILED, and a `reviewedSha`
 * indistinguishable from a clean one. Approving on that would put a machine's
 * name on a diff nothing ever successfully read.
 */
describe('BuilderPullRequestService — a failed review must not approve', () => {
  const HEAD = 'abc1234def';
  let service: any;
  let github: any;
  let repository: any;

  beforeEach(() => {
    repository = { update: jest.fn() };
    github = {
      getPullRequest: jest.fn(),
      getCheckRollup: jest.fn(),
      failedCheckExcerpts: jest.fn().mockResolvedValue({}),
      getCommitAuthor: jest.fn().mockResolvedValue({
        login: 'ally-builder[bot]',
        name: null,
        parents: ['one-parent'],
      }),
      approvePullRequest: jest
        .fn()
        .mockResolvedValue({ approved: true, message: null }),
    };
    service = Object.create(BuilderPullRequestService.prototype);
    Object.assign(service, {
      repository,
      feedbackRepository: { countActionable: jest.fn().mockResolvedValue(0) },
      github,
      settingsService: {
        get: jest
          .fn()
          .mockResolvedValue({ enabled: true, autoApproveEnabled: true }),
      },
      logger: { info: jest.fn(), warn: jest.fn() },
    });
  });

  const known = {
    remote: { state: 'open', merged: false, headSha: HEAD },
    rollup: { state: 'success' },
  };

  it('refuses a head whose review dispatched but never came back clean', async () => {
    await service.considerApproval(
      {
        id: 'pr-1',
        repo: 'ally-be',
        prNumber: 494,
        headSha: HEAD,
        // Stamped when the run was dispatched...
        reviewedSha: HEAD,
        // ...and never stamped, because the run failed.
        reviewPassedSha: null,
        approvedSha: null,
      },
      known,
    );

    expect(github.approvePullRequest).not.toHaveBeenCalled();
  });

  it('approves once a review has actually passed on that head', async () => {
    await service.considerApproval(
      {
        id: 'pr-1',
        repo: 'ally-be',
        prNumber: 494,
        headSha: HEAD,
        reviewedSha: HEAD,
        reviewPassedSha: HEAD,
        approvedSha: null,
      },
      known,
    );

    expect(github.approvePullRequest).toHaveBeenCalled();
  });
});
