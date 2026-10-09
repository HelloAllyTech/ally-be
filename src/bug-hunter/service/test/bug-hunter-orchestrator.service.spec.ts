import { ForbiddenException } from '@nestjs/common';

import { BugHunterOrchestratorService } from '../bug-hunter-orchestrator.service';
import { BugFinding } from '../../entity/bug-finding.entity';
import { BugFindingStatus, BugHunterMode } from '../../enum/bug-finding.enum';
import { BugHuntEventStage } from '../../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../../enum/bug-hunter-notification.enum';
import { BugFixVerdict } from '../../type/bug-fix-verdict.type';

const PR = 'https://github.com/HelloAllyTech/ally-web/pull/812';

const finding = (overrides: Partial<BugFinding> = {}): BugFinding =>
  ({
    id: 'f-1',
    repo: 'ally-web',
    runId: 'run-fix',
    title: 'Marathi keys missing',
    source: 'code_review',
    severity: 'medium',
    status: BugFindingStatus.NEW,
    proven: false,
    touchesGuardedPath: false,
    prUrl: null,
    budget: null,
    metadata: {},
    ...overrides,
  }) as BugFinding;

const failVerdict = (over: Partial<BugFixVerdict> = {}): BugFixVerdict =>
  ({
    verdict: 'fail',
    runId: 'run-verify',
    prUrl: PR,
    prHeadSha: 'head-1',
    checks: [{ name: 'suite', ok: false, evidence: '3 tests red' }],
    scopeExceeded: false,
    confidence: 0.9,
    summary: 'suite red',
    wouldBeWrongIf: null,
    by: { engine: 'gemini', model: 'gemini-2.5-pro' },
    at: new Date().toISOString(),
    ...over,
  }) as BugFixVerdict;

/**
 * One test per move the orchestrator can make (OPP-0783): the menu is code,
 * and every pick, veto and hand-over below is a behaviour nothing else
 * asserts.
 */
describe('BugHunterOrchestratorService', () => {
  let current: BugFinding;
  let findingRepository: {
    update: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let bugFindingService: { getOne: jest.Mock; setStatus: jest.Mock };
  let bugHunterService: {
    getSettings: jest.Mock;
    appendFindingEvent: jest.Mock;
  };
  let decisions: { decide: jest.Mock };
  let budget: { assertCanStartSession: jest.Mock };
  let policy: { assertMayFix: jest.Mock };
  let fixSession: { startByAgent: jest.Mock; retry: jest.Mock };
  let notifications: { notify: jest.Mock };
  let github: {
    getPullRequest: jest.Mock;
    updatePullRequestBranch: jest.Mock;
  };
  let service: BugHunterOrchestratorService;

  /** The decision service as a pass-through: the rule acts unless a model override is given for the point. */
  const decideWith = (overrides: Record<string, { pick: unknown }> = {}) =>
    jest.fn().mockImplementation(async (req) => {
      const o = overrides[req.point];
      const modelPick = o ? req.validate(o.pick) : null;
      const modelActs =
        !req.veto && !req.fixed && req.modelOwned && modelPick !== null;
      return {
        pick: modelActs ? modelPick : req.rule(),
        owner: modelActs ? 'model' : 'rule',
        shadowPick: modelActs ? req.rule() : modelPick,
        reason: req.veto ? `Veto (${req.veto.by}): ${req.veto.reason}` : 'rule',
        confidence: null,
        record: { id: `dec-${req.point}` },
      };
    });

  beforeEach(() => {
    current = finding();
    findingRepository = {
      update: jest.fn().mockImplementation((_id, patch) => {
        current = { ...current, ...patch } as BugFinding;
        return Promise.resolve();
      }),
      findOne: jest.fn().mockImplementation(() => Promise.resolve(current)),
      find: jest.fn().mockImplementation(() => Promise.resolve([current])),
    };
    bugFindingService = {
      getOne: jest.fn().mockImplementation(() => Promise.resolve(current)),
      setStatus: jest.fn().mockImplementation((_id, patch) => {
        current = { ...current, ...patch } as BugFinding;
        return Promise.resolve(current);
      }),
    };
    bugHunterService = {
      getSettings: jest.fn().mockResolvedValue({ mode: BugHunterMode.AI }),
      appendFindingEvent: jest.fn(),
    };
    decisions = { decide: decideWith() };
    budget = { assertCanStartSession: jest.fn().mockResolvedValue(undefined) };
    policy = { assertMayFix: jest.fn().mockResolvedValue(undefined) };
    fixSession = {
      startByAgent: jest.fn().mockResolvedValue(undefined),
      retry: jest.fn().mockResolvedValue(undefined),
    };
    notifications = { notify: jest.fn() };
    github = {
      getPullRequest: jest.fn().mockResolvedValue(null),
      updatePullRequestBranch: jest
        .fn()
        .mockResolvedValue({ updated: true, message: null }),
    };
    service = new BugHunterOrchestratorService(
      findingRepository as never,
      bugFindingService as never,
      bugHunterService as never,
      decisions as never,
      budget as never,
      policy as never,
      fixSession as never,
      notifications as never,
      github as never,
    );
  });

  const lastDecision = (point: string) =>
    decisions.decide.mock.calls
      .map(([r]) => r)
      .filter((r) => r.point === point)
      .pop();

  describe('D5 — a confirmed finding', () => {
    it('fix: starts the session by the verifier and remembers the move', async () => {
      expect(await service.onFindingConfirmed('f-1', 0.85)).toBe('fix');
      expect(fixSession.startByAgent).toHaveBeenCalledWith('f-1', 'verifier');
      const d5 = lastDecision('D5');
      expect(d5.menu).toEqual(['fix', 'ask_human']);
      expect(d5.modelOwned).toBe(true);
      expect(d5.veto).toBeUndefined();
      expect(current.metadata?.orchestrator).toMatchObject({
        retries: 0,
        lastMove: 'fix',
      });
    });

    it('ask_human by the model: holds the finding for a person and says why', async () => {
      decisions.decide = decideWith({ D5: { pick: 'ask_human' } });
      expect(await service.onFindingConfirmed('f-1', 0.85)).toBe('ask_human');
      expect(fixSession.startByAgent).not.toHaveBeenCalled();
      expect(bugFindingService.setStatus).toHaveBeenCalledWith('f-1', {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
      expect(bugHunterService.appendFindingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: BugHuntEventStage.ESCALATED,
          payload: expect.objectContaining({ move: 'ask_human', point: 'D5' }),
        }),
      );
    });

    it('vetoes in MANUAL mode without asking the model', async () => {
      bugHunterService.getSettings.mockResolvedValue({
        mode: BugHunterMode.MANUAL,
      });
      expect(await service.onFindingConfirmed('f-1', 0.9)).toBe('ask_human');
      expect(lastDecision('D5').veto).toMatchObject({ by: 'mode' });
      expect(fixSession.startByAgent).not.toHaveBeenCalled();
    });

    it('vetoes below the confidence bar, on a spent budget, and on a policy refusal', async () => {
      expect(await service.onFindingConfirmed('f-1', 0.5)).toBe('ask_human');
      expect(lastDecision('D5').veto).toMatchObject({ by: 'safety' });

      current = finding();
      budget.assertCanStartSession.mockRejectedValueOnce(
        new ForbiddenException('Budget: 2 of 2 sessions used'),
      );
      expect(await service.onFindingConfirmed('f-1', 0.9)).toBe('ask_human');
      expect(lastDecision('D5').veto).toMatchObject({
        by: 'budget',
        reason: 'Budget: 2 of 2 sessions used',
      });

      current = finding();
      policy.assertMayFix.mockRejectedValueOnce(
        new ForbiddenException('unverified'),
      );
      expect(await service.onFindingConfirmed('f-1', 0.9)).toBe('ask_human');
      expect(lastDecision('D5').veto).toMatchObject({ by: 'safety' });
    });

    it('leaves a finding a person already acted on alone', async () => {
      current = finding({ status: BugFindingStatus.DISMISSED });
      expect(await service.onFindingConfirmed('f-1', 0.9)).toBeNull();
      expect(decisions.decide).not.toHaveBeenCalled();
    });
  });

  describe('D7 — the Verifier refused a fix', () => {
    beforeEach(() => {
      current = finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: PR,
        metadata: { fixVerdicts: [failVerdict()] },
      });
    });

    it('retry_fix on the first refusal, with the named failures and the PR to continue on', async () => {
      const failures = ['suite: 3 tests red'];
      expect(await service.onFixRefused('f-1', failVerdict(), failures)).toBe(
        'retry_fix',
      );
      expect(fixSession.retry).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f-1' }),
        expect.objectContaining({
          kind: 'verifier_fail',
          move: 'retry_fix',
          failures,
          prUrl: PR,
          decisionId: 'dec-D7',
        }),
      );
      const d7 = lastDecision('D7');
      expect(d7.modelOwned).toBe(false);
      expect(d7.menu).toEqual([
        'retry_fix',
        'escalate_model',
        'ask_human',
        'close',
      ]);
      expect(notifications.notify).not.toHaveBeenCalled();
      expect(current.metadata?.orchestrator).toMatchObject({ retries: 1 });
    });

    it('escalate_model on the second refusal', async () => {
      current = finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: PR,
        metadata: {
          fixVerdicts: [failVerdict(), failVerdict()],
          orchestrator: { retries: 1 },
        },
      });
      expect(await service.onFixRefused('f-1', failVerdict(), ['x'])).toBe(
        'escalate_model',
      );
      expect(fixSession.retry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ move: 'escalate_model' }),
      );
    });

    it('ask_human after two automatic retries, telling the admin why', async () => {
      current = finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: PR,
        metadata: {
          fixVerdicts: [failVerdict(), failVerdict(), failVerdict()],
          orchestrator: { retries: 2 },
        },
      });
      expect(await service.onFixRefused('f-1', failVerdict(), ['x'])).toBe(
        'ask_human',
      );
      expect(fixSession.retry).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: BugHunterNotificationLevel.ACTION_NEEDED,
          title: expect.stringContaining('Verifier refused my fix'),
          body: expect.stringContaining('already sent this back 2 times'),
        }),
      );
    });

    it('ask_human when the diff did more than asked, or touches a guarded path', async () => {
      expect(
        await service.onFixRefused(
          'f-1',
          failVerdict({ scopeExceeded: true }),
          ['scope'],
        ),
      ).toBe('ask_human');
      expect(lastDecision('D7').veto).toMatchObject({ by: 'safety' });

      current = finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: PR,
        touchesGuardedPath: true,
        metadata: { fixVerdicts: [failVerdict()] },
      });
      expect(await service.onFixRefused('f-1', failVerdict(), ['x'])).toBe(
        'ask_human',
      );
      expect(fixSession.retry).not.toHaveBeenCalled();
    });

    it('ask_human on a spent budget, naming the budget', async () => {
      budget.assertCanStartSession.mockRejectedValueOnce(
        new ForbiddenException('Budget: $15 of $15 spent'),
      );
      expect(await service.onFixRefused('f-1', failVerdict(), ['x'])).toBe(
        'ask_human',
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Budget: $15 of $15 spent'),
        }),
      );
    });

    it('falls back to a person when the retry itself cannot start', async () => {
      fixSession.retry.mockRejectedValueOnce(new Error('GitHub 502'));
      expect(await service.onFixRefused('f-1', failVerdict(), ['x'])).toBe(
        'ask_human',
      );
      expect(notifications.notify).toHaveBeenCalled();
    });

    it("close is the model's shadow only: the rule never picks it", async () => {
      decisions.decide = decideWith({ D7: { pick: 'close' } });
      expect(await service.onFixRefused('f-1', failVerdict(), ['x'])).toBe(
        'retry_fix',
      );
    });
  });

  describe('D7 — a session failed', () => {
    beforeEach(() => {
      current = finding({
        status: BugFindingStatus.FAILED,
        metadata: {
          postmortem: {
            failingCheck: 'full suite',
            lastFailure: 'TypeError in RolePlayer',
            whyItFailed: 'patched the symptom',
            tryNext: 'look at the reducer',
          },
        },
      });
    });

    it('escalate_model once, with the post-mortem in hand', async () => {
      expect(await service.onSessionFailed('f-1')).toBe('escalate_model');
      expect(fixSession.retry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: 'session_failed',
          move: 'escalate_model',
          failures: ['TypeError in RolePlayer'],
          prUrl: null,
        }),
      );
      expect(lastDecision('D7').context.postmortem).toMatchObject({
        tryNext: 'look at the reducer',
      });
    });

    it('ask_human after that one retry, and on a spent budget', async () => {
      current = finding({
        status: BugFindingStatus.FAILED,
        metadata: { orchestrator: { retries: 1 } },
      });
      expect(await service.onSessionFailed('f-1')).toBe('ask_human');
      expect(fixSession.retry).not.toHaveBeenCalled();

      current = finding({ status: BugFindingStatus.FAILED });
      budget.assertCanStartSession.mockRejectedValueOnce(
        new ForbiddenException('spent'),
      );
      expect(await service.onSessionFailed('f-1')).toBe('ask_human');
      expect(lastDecision('D7').veto).toMatchObject({ by: 'budget' });
    });

    it('does nothing for a finding that is not FAILED, or a repo with no fix workflow', async () => {
      current = finding({ status: BugFindingStatus.FIXING });
      expect(await service.onSessionFailed('f-1')).toBeNull();
      current = finding({
        status: BugFindingStatus.FAILED,
        repo: 'not-a-repo',
      });
      expect(await service.onSessionFailed('f-1')).toBeNull();
      expect(decisions.decide).not.toHaveBeenCalled();
    });
  });

  describe('open PRs — conflicts and stale branches (OPP-0758)', () => {
    beforeEach(() => {
      current = finding({ status: BugFindingStatus.PR_OPENED, prUrl: PR });
      findingRepository.find = jest
        .fn()
        .mockImplementation(() => Promise.resolve([current]));
    });

    it('sends a conflicted PR back to a session to rebase, once per head', async () => {
      github.getPullRequest.mockResolvedValue({
        merged: false,
        state: 'open',
        headSha: 'abc1234def',
        mergeableState: 'dirty',
      });
      await service.reconcileOpenPullRequests();
      expect(fixSession.retry).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f-1' }),
        expect.objectContaining({
          kind: 'conflict',
          move: 'retry_fix',
          prUrl: PR,
          failures: [expect.stringContaining('merge conflict')],
        }),
      );
      expect(lastDecision('D7').context).toMatchObject({ cause: 'conflict' });
      expect(current.metadata?.prConflict).toMatchObject({
        headSha: 'abc1234def',
      });

      fixSession.retry.mockClear();
      await service.reconcileOpenPullRequests();
      expect(fixSession.retry).not.toHaveBeenCalled();
    });

    it('asks a person about a conflict once the retries are spent', async () => {
      current = finding({
        status: BugFindingStatus.PR_OPENED,
        prUrl: PR,
        metadata: { orchestrator: { retries: 2 } },
      });
      expect(await service.onPrConflict('f-1', 'abc1234def')).toBe('ask_human');
      expect(fixSession.retry).not.toHaveBeenCalled();
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('in conflict with master'),
        }),
      );
    });

    it('asks GitHub to update a branch that is merely behind, once per head, and leaves a clean PR alone', async () => {
      github.getPullRequest.mockResolvedValue({
        merged: false,
        state: 'open',
        headSha: 'h1',
        mergeableState: 'behind',
      });
      await service.reconcileOpenPullRequests();
      expect(github.updatePullRequestBranch).toHaveBeenCalledWith(
        'ally-web',
        812,
        'h1',
      );
      expect(current.metadata?.prBranchUpdate).toMatchObject({
        headSha: 'h1',
        updated: true,
      });
      expect(decisions.decide).not.toHaveBeenCalled();

      github.updatePullRequestBranch.mockClear();
      await service.reconcileOpenPullRequests();
      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();

      github.getPullRequest.mockResolvedValue({
        merged: false,
        state: 'open',
        headSha: 'h2',
        mergeableState: 'clean',
      });
      await service.reconcileOpenPullRequests();
      expect(github.updatePullRequestBranch).not.toHaveBeenCalled();
      expect(fixSession.retry).not.toHaveBeenCalled();
    });
  });

  describe('D4 and D8 — fixed points, recorded', () => {
    it('records the Verifier choice as a fixed rule without a model', async () => {
      await service.recordVerifierChoice({
        repo: 'ally-web',
        runId: 'run-verify',
        findingId: 'f-1',
        subject: 'fix',
        producer: { engine: 'gemini', model: 'gemini-2.5-flash' },
        counterpart: { engine: 'gemini', model: 'gemini-2.5-pro' },
      });
      const d4 = lastDecision('D4');
      expect(d4.fixed).toMatch(/other vendor/);
      expect(d4.modelOwned).toBe(false);
      expect(d4.rule()).toEqual({ engine: 'gemini', model: 'gemini-2.5-pro' });
    });

    it('records the merge gate with the policy reason', async () => {
      current = finding({ status: BugFindingStatus.PR_OPENED, prUrl: PR });
      await service.recordMergeGate({
        finding: current,
        verdict: failVerdict({ verdict: 'pass' }),
        allowed: false,
        reason: 'ally-web never self-merges',
      });
      const d8 = lastDecision('D8');
      expect(d8.rule()).toBe('ask_human');
      expect(d8.fixed).toBe('ally-web never self-merges');
      expect(d8.menu).toEqual(['merge', 'ask_human']);
    });

    it('never throws out of a record: a decision store that is down does not stop a merge', async () => {
      decisions.decide.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.recordMergeGate({
          finding: current,
          verdict: failVerdict({ verdict: 'pass' }),
          allowed: true,
          reason: 'ok',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
