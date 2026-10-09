import { BugHunterPrReviewService } from '../bug-hunter-pr-review.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus, BugHunterMode } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../../enum/bug-hunt-run.enum';

const pr = (over: Record<string, unknown> = {}) => ({
  htmlUrl: 'https://github.com/HelloAllyTech/ally-be/pull/700',
  headRef: 'feat/x',
  number: 700,
  headSha: 'aaaa111',
  baseRef: 'master',
  authorLogin: 'gksoriginals',
  title: 'feat: a thing',
  body: 'Adds a thing.',
  draft: false,
  updatedAt: new Date(),
  ...over,
});

describe('BugHunterPrReviewService', () => {
  let github: {
    listPullRequests: jest.Mock;
    dispatchWorkflow: jest.Mock;
    createPullRequestReview: jest.Mock;
  };
  let bugHunterService: {
    getSettings: jest.Mock;
    startRun: jest.Mock;
    setRunMetadata: jest.Mock;
    closeRun: jest.Mock;
    appendEvent: jest.Mock;
    appendFindingEvent: jest.Mock;
  };
  let bugFindingService: { setStatus: jest.Mock };
  let runRepository: { find: jest.Mock };
  let findingRepository: { update: jest.Mock };
  let service: BugHunterPrReviewService;

  beforeEach(() => {
    github = {
      listPullRequests: jest.fn().mockResolvedValue([]),
      dispatchWorkflow: jest.fn().mockResolvedValue(new Date()),
      createPullRequestReview: jest
        .fn()
        .mockResolvedValue(
          'https://github.com/HelloAllyTech/ally-be/pull/700#pullrequestreview-9',
        ),
    };
    bugHunterService = {
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.MANUAL }),
      startRun: jest.fn().mockResolvedValue({ id: 'run-pr' }),
      setRunMetadata: jest.fn(),
      closeRun: jest.fn(),
      appendEvent: jest.fn(),
      appendFindingEvent: jest.fn(),
    };
    bugFindingService = { setStatus: jest.fn() };
    runRepository = { find: jest.fn().mockResolvedValue([]) };
    findingRepository = { update: jest.fn() };
    service = new BugHunterPrReviewService(
      github as never,
      bugHunterService as never,
      bugFindingService as never,
      runRepository as never,
      findingRepository as never,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
    );
  });

  describe('poll', () => {
    it("starts one pr_review run per unseen head of a person's open PR, skipping bots, drafts and stale PRs", async () => {
      github.listPullRequests.mockImplementation((repo: string) =>
        Promise.resolve(
          repo === 'ally-be'
            ? [
                pr(),
                pr({
                  number: 701,
                  headSha: 'bbbb222',
                  authorLogin: 'ally-bug-hunter[bot]',
                }),
                pr({ number: 702, headSha: 'cccc333', draft: true }),
                pr({
                  number: 703,
                  headSha: 'dddd444',
                  updatedAt: new Date(Date.now() - 30 * 86_400_000),
                }),
              ]
            : [],
        ),
      );
      // #700 at this head was reviewed already: a second run must not start.
      runRepository.find.mockImplementation(
        ({ where }: { where: { repo: string } }) =>
          Promise.resolve(
            where.repo === 'ally-be'
              ? [
                  {
                    trigger: BugHuntTrigger.PR_REVIEW,
                    metadata: { prReview: { number: 700, headSha: 'old0000' } },
                  },
                ]
              : [],
          ),
      );

      expect(await service.poll()).toBe(1);
      expect(bugHunterService.startRun).toHaveBeenCalledWith(
        BugHuntTrigger.PR_REVIEW,
        'ally-be',
      );
      expect(bugHunterService.setRunMetadata).toHaveBeenCalledWith('run-pr', {
        prReview: expect.objectContaining({
          number: 700,
          headSha: 'aaaa111',
          author: 'gksoriginals',
        }),
      });
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'ally-be',
          workflow: 'bug-hunt-sweep.yml',
          inputs: expect.objectContaining({
            run_id: 'run-pr',
            mode: 'pr_review',
            pr_number: '700',
          }),
        }),
      );
      expect(bugHunterService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.FINDER_RESULT,
          runId: 'run-pr',
        }),
      );
    });

    it('skips a head it has already opened a run for, and does nothing while Bug Hunter is off', async () => {
      github.listPullRequests.mockResolvedValue([pr()]);
      runRepository.find.mockResolvedValue([
        {
          trigger: BugHuntTrigger.PR_REVIEW,
          metadata: { prReview: { number: 700, headSha: 'aaaa111' } },
        },
      ]);
      expect(await service.poll()).toBe(0);

      runRepository.find.mockResolvedValue([]);
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.OFF,
      });
      expect(await service.poll()).toBe(0);
      expect(bugHunterService.startRun).not.toHaveBeenCalled();
    });

    it('closes the run it opened when GitHub refuses the dispatch', async () => {
      github.listPullRequests.mockImplementation((repo: string) =>
        Promise.resolve(repo === 'ally-be' ? [pr()] : []),
      );
      github.dispatchWorkflow.mockRejectedValue(new Error('422'));
      expect(await service.poll()).toBe(0);
      expect(bugHunterService.closeRun).toHaveBeenCalledWith(
        'run-pr',
        BugHuntRunStatus.FAILED,
        expect.anything(),
        '422',
      );
    });
  });

  describe('commentForFinding', () => {
    const finding = (over: Partial<BugFinding> = {}): BugFinding =>
      ({
        id: 'f-1',
        repo: 'ally-be',
        title: 'Health check swallows the Redis error',
        description: 'The catch block returns ok even when PING failed.',
        evidence: 'health.controller.ts:42',
        file: 'src/health/controller/health.controller.ts',
        severity: 'medium',
        status: BugFindingStatus.NEW,
        metadata: {
          pr: {
            number: 700,
            url: 'https://github.com/HelloAllyTech/ally-be/pull/700',
            headSha: 'aaaa111',
          },
          findingVerdicts: [
            {
              verdict: 'confirmed',
              reproduction: 'curl /api/health with Redis down returns 200',
              by: { engine: 'gemini', model: 'gemini-2.5-pro' },
            },
          ],
        },
        ...overrides(over),
      }) as BugFinding;
    const overrides = (o: Partial<BugFinding>) => o;

    it('posts a COMMENT review with the finding and the reproduction, records the URL, and holds the finding', async () => {
      const f = finding();
      const url = await service.commentForFinding(f);
      expect(url).toContain('pullrequestreview-9');
      expect(github.createPullRequestReview).toHaveBeenCalledWith(
        'ally-be',
        700,
        expect.objectContaining({
          commitId: 'aaaa111',
          body: expect.stringContaining(
            'Reproduced by**: curl /api/health with Redis down returns 200',
          ),
          comments: [
            expect.objectContaining({
              path: 'src/health/controller/health.controller.ts',
            }),
          ],
        }),
      );
      expect(github.createPullRequestReview.mock.calls[0][2].body).toMatch(
        /merge is your call/,
      );
      expect(findingRepository.update).toHaveBeenCalledWith(
        'f-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            pr: expect.objectContaining({
              commentUrl: expect.stringContaining('pullrequestreview-9'),
            }),
          }),
        }),
      );
      expect(bugFindingService.setStatus).toHaveBeenCalledWith('f-1', {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
      expect(bugHunterService.appendFindingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.ESCALATED,
          summary: expect.stringContaining('Commented on'),
        }),
      );
    });

    it('does not comment twice, and holds the finding even when GitHub refuses', async () => {
      const already = finding({
        metadata: {
          pr: {
            number: 700,
            url: 'u',
            headSha: 'a',
            commentUrl: 'https://x/#r',
          },
        },
      });
      expect(await service.commentForFinding(already)).toBe('https://x/#r');
      expect(github.createPullRequestReview).not.toHaveBeenCalled();

      github.createPullRequestReview.mockResolvedValue(null);
      expect(await service.commentForFinding(finding())).toBeNull();
      expect(bugFindingService.setStatus).toHaveBeenCalledWith('f-1', {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
    });

    it('does nothing for a finding with no PR link', async () => {
      expect(
        await service.commentForFinding(finding({ metadata: {} })),
      ).toBeNull();
      expect(github.createPullRequestReview).not.toHaveBeenCalled();
    });
  });
});
