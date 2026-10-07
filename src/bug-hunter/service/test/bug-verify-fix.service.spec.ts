import { ForbiddenException } from '@nestjs/common';

import { BugVerifyFixService, counterpartFor } from '../bug-verify-fix.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHuntTrigger } from '../../enum/bug-hunt-run.enum';
import { BugHunterNotificationLevel } from '../../enum/bug-hunter-notification.enum';

const PR = 'https://github.com/HelloAllyTech/ally-web/pull/812';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    runId: 'run-fix',
    status: BugFindingStatus.PR_OPENED,
    title: 'English text with Marathi selected',
    prUrl: PR,
    touchesGuardedPath: false,
    metadata: {},
    ...overrides,
  }) as BugFinding;

const okChecks = [
  { name: 'repro_at_base_fails', ok: true, evidence: 'exit 1' },
  { name: 'repro_at_head_passes', ok: true, evidence: 'exit 0' },
  { name: 'suite', ok: true, evidence: 'green' },
  { name: 'diff_vs_brief', ok: true, evidence: '72 hunks, all locale files' },
];

describe('counterpartFor', () => {
  const settings = {
    engine: 'gemini',
    defaultModel: 'gemini-2.5-pro',
    escalationModel: 'gemini-2.5-pro',
  };
  it('pairs a Gemini-made fix with a Claude verifier and the reverse', () => {
    expect(counterpartFor('gemini', 'gemini-2.5-pro', settings)).toEqual({
      engine: 'claude-code',
      model: 'claude-sonnet-5',
    });
    expect(counterpartFor('claude-code', 'claude-sonnet-5', settings)).toEqual({
      engine: 'gemini',
      model: 'gemini-2.5-pro',
    });
  });
  it('classifies OpenCode by the model it ran, and falls back to the platform default when the fix run is unknown', () => {
    expect(counterpartFor('opencode', 'gemini-2.5-pro', settings).engine).toBe(
      'claude-code',
    );
    expect(counterpartFor('opencode', 'claude-sonnet-5', settings).engine).toBe(
      'gemini',
    );
    expect(counterpartFor(null, null, settings).engine).toBe('claude-code');
    expect(
      counterpartFor(null, null, {
        ...settings,
        engine: 'claude-code',
        defaultModel: 'claude-sonnet-5',
      }).engine,
    ).toBe('gemini');
  });
});

describe('BugVerifyFixService', () => {
  let findingRepository: { update: jest.Mock };
  let bugFindingService: { getOne: jest.Mock };
  let bugHunterService: {
    getRun: jest.Mock;
    startRun: jest.Mock;
    closeRun: jest.Mock;
    appendEvent: jest.Mock;
    appendFindingEvent: jest.Mock;
  };
  let github: {
    getPullRequest: jest.Mock;
    dispatchWorkflow: jest.Mock;
    createIssueComment: jest.Mock;
  };
  let notifications: { notify: jest.Mock };
  let policy: { assertMayMerge: jest.Mock };
  let fixSession: { mergeVerifiedFinding: jest.Mock };
  let service: BugVerifyFixService;
  let current: BugFinding;

  beforeEach(() => {
    current = finding();
    findingRepository = {
      update: jest.fn().mockImplementation((_id, patch) => {
        current = { ...current, ...patch } as BugFinding;
        return Promise.resolve();
      }),
    };
    bugFindingService = {
      getOne: jest.fn().mockImplementation(() => Promise.resolve(current)),
    };
    bugHunterService = {
      getRun: jest.fn().mockResolvedValue({
        id: 'run-fix',
        engine: 'gemini',
        model: 'gemini-2.5-pro',
      }),
      startRun: jest.fn().mockResolvedValue({ id: 'run-verify' }),
      closeRun: jest.fn(),
      appendEvent: jest.fn(),
      appendFindingEvent: jest.fn(),
    };
    github = {
      getPullRequest: jest
        .fn()
        .mockResolvedValue({ headSha: 'head-1', merged: false, state: 'open' }),
      dispatchWorkflow: jest.fn().mockResolvedValue(new Date()),
      createIssueComment: jest.fn().mockResolvedValue('c'),
    };
    notifications = { notify: jest.fn() };
    policy = { assertMayMerge: jest.fn().mockResolvedValue(undefined) };
    fixSession = {
      mergeVerifiedFinding: jest.fn().mockResolvedValue(undefined),
    };
    service = new BugVerifyFixService(
      findingRepository as never,
      bugFindingService as never,
      bugHunterService as never,
      github as never,
      notifications as never,
      policy as never,
      fixSession as never,
      {
        get: jest.fn().mockResolvedValue({
          engine: 'gemini',
          defaultModel: 'gemini-2.5-pro',
          escalationModel: 'gemini-2.5-pro',
        }),
      } as never,
      { publicApiBaseUrl: 'https://api.example.com' } as never,
    );
  });

  describe('dispatch', () => {
    it('opens a verify_fix run on the other vendor and hands the workflow the PR in verify mode', async () => {
      const dispatched = await service.dispatch('f-1');

      expect(bugHunterService.startRun).toHaveBeenCalledWith(
        BugHuntTrigger.VERIFY_FIX,
        'ally-web',
      );
      expect(dispatched).toMatchObject({
        runId: 'run-verify',
        prNumber: 812,
        prHeadSha: 'head-1',
        fixEngine: 'gemini',
        counterpart: { engine: 'claude-code', model: 'claude-sonnet-5' },
      });
      expect(findingRepository.update).toHaveBeenCalledWith(
        'f-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            verifyFix: expect.objectContaining({ runId: 'run-verify' }),
          }),
        }),
      );
      expect(github.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'ally-web',
          inputs: expect.objectContaining({
            mode: 'verify',
            run_id: 'run-verify',
            finding_id: 'f-1',
          }),
        }),
      );
      expect(bugHunterService.appendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.VERIFY,
          runId: 'run-verify',
        }),
      );
    });

    it('does nothing for a finding that is not at PR_OPENED, has no PR, or already has a verdict for this head', async () => {
      current = finding({ status: BugFindingStatus.FIXING });
      expect(await service.dispatch('f-1')).toBeNull();
      current = finding({ prUrl: null });
      expect(await service.dispatch('f-1')).toBeNull();
      current = finding({
        metadata: {
          fixVerdicts: [
            {
              verdict: 'pass',
              prUrl: PR,
              prHeadSha: 'head-1',
              at: '2026-10-07T00:00:00Z',
              checks: [],
            },
          ],
        },
      });
      expect(await service.dispatch('f-1')).toBeNull();
      expect(bugHunterService.startRun).not.toHaveBeenCalled();
    });

    it('closes the run it opened and leaves the PR for a person when GitHub refuses the dispatch', async () => {
      github.dispatchWorkflow.mockRejectedValue(new Error('422'));

      expect(await service.dispatch('f-1')).toBeNull();
      expect(bugHunterService.closeRun).toHaveBeenCalledWith(
        'run-verify',
        'failed',
        expect.anything(),
        '422',
      );
    });
  });

  describe('recordVerdict', () => {
    it('stores a computed pass, posts it on the PR, and merges where policy allows', async () => {
      current = finding({
        metadata: {
          verifyFix: {
            runId: 'run-verify',
            prHeadSha: 'head-1',
            counterpart: { engine: 'claude-code', model: 'claude-sonnet-5' },
          },
        },
      });
      bugHunterService.getRun.mockResolvedValue({
        id: 'run-verify',
        engine: 'gemini',
        model: 'gemini-2.5-pro',
      });

      const verdict = await service.recordVerdict('f-1', {
        runId: 'run-verify',
        checks: okChecks,
        confidence: 0.9,
        summary: 'Adds the keys, nothing else.',
      });

      expect(verdict?.verdict).toBe('pass');
      expect(verdict?.by).toEqual({
        engine: 'gemini',
        model: 'gemini-2.5-pro',
      });
      expect(current.metadata?.fixVerdicts).toHaveLength(1);
      expect(current.metadata?.verifyFix).toBeNull();
      expect(github.createIssueComment).toHaveBeenCalledWith(
        'ally-web',
        812,
        expect.stringContaining('Bug Hunter Verifier: PASS'),
      );
      expect(policy.assertMayMerge).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f-1' }),
        PR,
        { verified: true },
      );
      expect(fixSession.mergeVerifiedFinding).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f-1' }),
        expect.objectContaining({ verdict: 'pass' }),
      );
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('hands a passed fix to a person when policy refuses the self-merge', async () => {
      policy.assertMayMerge.mockRejectedValue(
        new ForbiddenException('"ally-mobile" never auto-merges'),
      );

      await service.recordVerdict('f-1', { checks: okChecks });

      expect(fixSession.mergeVerifiedFinding).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: BugHunterNotificationLevel.ACTION_NEEDED,
          title: expect.stringContaining('Verified and ready for your merge'),
        }),
      );
    });

    it('refuses a fix with a failed check, names the failure to the admin, and never merges', async () => {
      const verdict = await service.recordVerdict('f-1', {
        checks: [
          ...okChecks,
          {
            name: 'data_file_counts',
            ok: false,
            evidence: 'blank values 0 → 385 in mr.json',
          },
        ],
      });

      expect(verdict?.verdict).toBe('fail');
      expect(github.createIssueComment).toHaveBeenCalledWith(
        'ally-web',
        812,
        expect.stringContaining('blank values 0 → 385'),
      );
      expect(policy.assertMayMerge).not.toHaveBeenCalled();
      expect(fixSession.mergeVerifiedFinding).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: BugHunterNotificationLevel.ACTION_NEEDED,
          title: expect.stringContaining('Verifier refused my fix'),
          body: expect.stringContaining(
            'data_file_counts: blank values 0 → 385 in mr.json',
          ),
        }),
      );
    });

    it('records nothing for a report without checks', async () => {
      expect(
        await service.recordVerdict('f-1', { verdict: 'pass' }),
      ).toBeNull();
      expect(findingRepository.update).not.toHaveBeenCalled();
    });
  });
});
