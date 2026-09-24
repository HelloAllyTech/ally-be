import { ForbiddenException } from '@nestjs/common';

import {
  BugHunterPolicyService,
  prNumberFrom,
} from '../bug-hunter-policy.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugHuntRun } from '../../entity/bug-hunt-run.entity';
import {
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../../enum/bug-finding.enum';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import {
  BUG_HUNT_LOW_CONFIDENCE_THRESHOLD,
  BUG_HUNT_MAX_AUTO_MERGES_PER_RUN,
  BUG_HUNT_TRIVIAL_FIX_MAX_FILES,
  BUG_HUNT_TRIVIAL_LINT_FIX_MAX_FILES,
} from '../../constants/bug-hunter.constants';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    runId: 'run-1',
    // The one repo the bot may merge to — see bug-hunt-repos.constants.
    repo: 'ally-ai-learn',
    source: BugFindingSource.CODE_REVIEW,
    status: BugFindingStatus.NEW,
    proven: false,
    touchesGuardedPath: false,
    prUrl: 'https://github.com/HelloAllyTech/ally-ai-learn/pull/42',
    metadata: { confidence: 0.9 },
    ...overrides,
  }) as BugFinding;

const run = (overrides: Partial<BugHuntRun> = {}): BugHuntRun =>
  ({
    id: 'run-1',
    trigger: BugHuntTrigger.SCHEDULED,
    repo: 'ally-ai-learn',
    ...overrides,
  }) as BugHuntRun;

describe('BugHunterPolicyService', () => {
  let service: BugHunterPolicyService;
  let bugFindingService: { getOne: jest.Mock };
  let bugHunterService: { getRun: jest.Mock; getSettings: jest.Mock };
  let findingRepository: { count: jest.Mock };
  let github: { listPullRequestFiles: jest.Mock };

  beforeEach(() => {
    bugFindingService = { getOne: jest.fn().mockResolvedValue(finding()) };
    bugHunterService = {
      getRun: jest.fn().mockResolvedValue(run()),
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.AI }),
    };
    findingRepository = { count: jest.fn().mockResolvedValue(0) };
    github = {
      listPullRequestFiles: jest.fn().mockResolvedValue({
        files: ['src/a.py', 'tests/test_a.py'],
        truncated: false,
      }),
    };
    service = new BugHunterPolicyService(
      bugFindingService as never,
      bugHunterService as never,
      findingRepository as never,
      github as never,
    );
  });

  const fixing = () =>
    service.assertTransitionAllowed('f-1', { status: BugFindingStatus.FIXING });
  const merging = () =>
    service.assertTransitionAllowed('f-1', { status: BugFindingStatus.MERGED });

  it('ignores transitions it does not gate, without touching the database', async () => {
    await expect(
      service.assertTransitionAllowed('f-1', {
        status: BugFindingStatus.PR_OPENED,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertTransitionAllowed('f-1', {}),
    ).resolves.toBeUndefined();
    expect(bugFindingService.getOne).not.toHaveBeenCalled();
  });

  describe('fixing', () => {
    it('allows a verified, confident finding in AI mode', async () => {
      await expect(fixing()).resolves.toBeUndefined();
    });

    it('allows an approved finding whatever the mode — approval once given does not evaporate', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({ status: BugFindingStatus.APPROVED, metadata: null }),
      );
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.MANUAL,
      });
      await expect(fixing()).resolves.toBeUndefined();
    });

    it('allows a fix session an admin dispatched, whatever the finding looks like', async () => {
      bugHunterService.getRun.mockResolvedValue(
        run({ trigger: BugHuntTrigger.FIX_SESSION }),
      );
      bugFindingService.getOne.mockResolvedValue(finding({ metadata: null }));
      await expect(fixing()).resolves.toBeUndefined();
      expect(bugHunterService.getSettings).not.toHaveBeenCalled();
    });

    it('refuses in MANUAL mode unless approved, and says what to do instead', async () => {
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.MANUAL,
      });
      await expect(fixing()).rejects.toThrow(/MANUAL mode.*pending_approval/s);
    });

    it('refuses when the switch is off', async () => {
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.OFF,
      });
      await expect(fixing()).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a proven finding with no verifier confidence — tests and logs are ground truth', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({ proven: true, metadata: null }),
      );
      await expect(fixing()).resolves.toBeUndefined();
    });

    it('refuses an unproven finding that never went through Verify', async () => {
      bugFindingService.getOne.mockResolvedValue(finding({ metadata: null }));
      await expect(fixing()).rejects.toThrow(/no verifier confidence/);
    });

    it('refuses a finding the engine could not verify, even if a confidence was somehow set', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({
          metadata: { confidence: 0.95, verificationUnavailable: true },
        }),
      );
      await expect(fixing()).rejects.toThrow(/never independently verified/);
    });

    it('holds a low-confidence finding for a human even in AI mode', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({
          metadata: { confidence: BUG_HUNT_LOW_CONFIDENCE_THRESHOLD - 0.01 },
        }),
      );
      await expect(fixing()).rejects.toThrow(/below/);
    });

    it('treats the threshold itself as confident enough', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({
          metadata: { confidence: BUG_HUNT_LOW_CONFIDENCE_THRESHOLD },
        }),
      );
      await expect(fixing()).resolves.toBeUndefined();
    });
  });

  describe('merging', () => {
    it('allows a small, unguarded sweep fix under the cap in a repo the bot may merge to', async () => {
      await expect(merging()).resolves.toBeUndefined();
      expect(github.listPullRequestFiles).toHaveBeenCalledWith(
        'ally-ai-learn',
        42,
      );
    });

    it('never merges a guarded-path change, whoever asked', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({ touchesGuardedPath: true }),
      );
      bugHunterService.getRun.mockResolvedValue(
        run({ trigger: BugHuntTrigger.FIX_SESSION }),
      );
      await expect(merging()).rejects.toThrow(/guarded path/);
    });

    it.each(['ally-mobile', 'ally-be', 'ally-web', 'ally-ai'])(
      'never merges in %s, where the bot cannot or must not land a change',
      async (repo) => {
        bugFindingService.getOne.mockResolvedValue(finding({ repo }));
        await expect(merging()).rejects.toThrow(/never auto-merges/);
        expect(github.listPullRequestFiles).not.toHaveBeenCalled();
      },
    );

    it('exempts a fix session from the sweep cap and the trivial-diff rule', async () => {
      bugHunterService.getRun.mockResolvedValue(
        run({ trigger: BugHuntTrigger.FIX_SESSION }),
      );
      findingRepository.count.mockResolvedValue(99);
      await expect(merging()).resolves.toBeUndefined();
      expect(github.listPullRequestFiles).not.toHaveBeenCalled();
    });

    it('refuses once the run has merged its nightly cap', async () => {
      findingRepository.count.mockResolvedValue(
        BUG_HUNT_MAX_AUTO_MERGES_PER_RUN,
      );
      await expect(merging()).rejects.toThrow(/nightly cap/);
      expect(findingRepository.count).toHaveBeenCalledWith({
        where: { runId: 'run-1', status: BugFindingStatus.MERGED },
      });
    });

    it('refuses a sweep merge with no PR to size', async () => {
      bugFindingService.getOne.mockResolvedValue(finding({ prUrl: null }));
      await expect(merging()).rejects.toThrow(/No pull request URL/);
    });

    it('reads the PR number from the patch when the finding has none yet', async () => {
      bugFindingService.getOne.mockResolvedValue(finding({ prUrl: null }));
      await service.assertTransitionAllowed('f-1', {
        status: BugFindingStatus.MERGED,
        prUrl: 'https://github.com/HelloAllyTech/ally-ai-learn/pull/7',
      });
      expect(github.listPullRequestFiles).toHaveBeenCalledWith(
        'ally-ai-learn',
        7,
      );
    });

    it('refuses a diff wider than one file plus its test', async () => {
      github.listPullRequestFiles.mockResolvedValue({
        files: Array.from(
          { length: BUG_HUNT_TRIVIAL_FIX_MAX_FILES + 1 },
          (_, i) => `src/f${i}.py`,
        ),
        truncated: false,
      });
      await expect(merging()).rejects.toThrow(
        /single-file change plus its test/,
      );
    });

    it('lets a lint fix touch more files, up to its own limit', async () => {
      bugFindingService.getOne.mockResolvedValue(
        finding({ source: BugFindingSource.LINT_ERROR }),
      );
      github.listPullRequestFiles.mockResolvedValue({
        files: Array.from(
          { length: BUG_HUNT_TRIVIAL_LINT_FIX_MAX_FILES },
          (_, i) => `src/f${i}.py`,
        ),
        truncated: false,
      });
      await expect(merging()).resolves.toBeUndefined();

      github.listPullRequestFiles.mockResolvedValue({
        files: Array.from(
          { length: BUG_HUNT_TRIVIAL_LINT_FIX_MAX_FILES + 1 },
          (_, i) => `src/f${i}.py`,
        ),
        truncated: false,
      });
      await expect(merging()).rejects.toThrow(/lint fix touching at most/);
    });

    it('fails closed when GitHub cannot be read or the listing is truncated', async () => {
      github.listPullRequestFiles.mockRejectedValue(new Error('503'));
      await expect(merging()).rejects.toThrow(
        /Could not read the pull request/,
      );

      github.listPullRequestFiles.mockResolvedValue({
        files: [],
        truncated: true,
      });
      await expect(merging()).rejects.toThrow(/more files than can be listed/);
    });
  });

  describe('prNumberFrom', () => {
    it('reads the number from a GitHub PR URL and nothing else', () => {
      expect(
        prNumberFrom('https://github.com/HelloAllyTech/ally-be/pull/512'),
      ).toBe(512);
      expect(
        prNumberFrom('https://github.com/HelloAllyTech/ally-be'),
      ).toBeNull();
    });
  });
});
