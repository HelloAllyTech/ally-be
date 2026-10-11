import { Injectable } from '@nestjs/common';

import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import { repoCommands } from '../constants/bug-hunt-repos.constants';
import { prNumberFrom } from './bug-hunter-policy.service';
import { BUG_HUNT_LOW_CONFIDENCE_THRESHOLD } from '../constants/bug-hunter.constants';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus, BugHunterMode } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugFixVerdict } from '../type/bug-fix-verdict.type';
import { BugHunterEngine } from '../type/bug-hunter-model-settings.type';
import {
  BUG_HUNTER_D5_MENU,
  BUG_HUNTER_D7_MAX_AUTOMATIC_RETRIES,
  BUG_HUNTER_D7_MENU,
  BUG_HUNTER_D8_MENU,
  BUG_HUNTER_DECISION_OWNER_DEFAULTS,
  BugHunterMove,
  D5Pick,
  D7Pick,
  D8Pick,
  OrchestratorState,
  OrchestratorVeto,
  orchestratorStateOf as stateOf,
} from '../type/bug-hunter-orchestrator.type';
import { BugCaseBudgetService } from './bug-case-budget.service';
import { BugFindingService } from './bug-finding.service';
import { BugFixSessionService } from './bug-fix-session.service';
import { BugHunterDecisionService } from './bug-hunter-decision.service';
import { BugHunterNotificationService } from './bug-hunter-notification.service';
import { BugHunterPolicyService } from './bug-hunter-policy.service';
import { BugHunterPrReviewService } from './bug-hunter-pr-review.service';
import { BugHunterService } from './bug-hunter.service';

/**
 * The orchestrator — OPP-0783. See `bug-hunter-orchestrator.type.ts` for
 * the menu and the ownership table.
 *
 * It owns the moves between stages that used to live in prompts and in the
 * two verifier services' `actOnVerdict` methods:
 *
 *   D5  a finding the independent Verifier confirmed: fix now, or hold it
 *       for a person.
 *   D7  a fix the Verifier refused, or a session that failed: retry on the
 *       same tier, retry on the strong tier, ask a person, or close.
 *   D4  which Verifier reads a finding or a fix — recorded, fixed by rule.
 *   D8  whether a verified fix merges itself — recorded, fixed by rule.
 *
 * Every move is one decision row. A budget or safety veto is a row too, so
 * the replay can see how often the vetoes fire and on what.
 */
@Injectable()
export class BugHunterOrchestratorService {
  private readonly logger = LoggerService.getInstance(
    BugHunterOrchestratorService.name,
  );

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly bugFindingService: BugFindingService,
    private readonly bugHunterService: BugHunterService,
    private readonly decisions: BugHunterDecisionService,
    private readonly budgetService: BugCaseBudgetService,
    private readonly policyService: BugHunterPolicyService,
    private readonly fixSessionService: BugFixSessionService,
    private readonly notificationService: BugHunterNotificationService,
    private readonly github: GithubActionsService,
    private readonly prReview: BugHunterPrReviewService,
  ) {}

  // ── open PRs: conflicts and stale branches (OPP-0758) ────────────────────

  /**
   * Every five minutes, every fix PR still open: a PR GitHub calls `dirty`
   * has fallen into conflict with master and goes to D7 once per head; a PR
   * that is merely `behind` gets its branch updated by GitHub, once per
   * head, so CI and the Verifier see it against today's master. A reviewer
   * used to find both states by hand and either leave the PR or redo it.
   */
  async reconcileOpenPullRequests(): Promise<void> {
    const open = await this.findingRepository.find({
      where: { status: BugFindingStatus.PR_OPENED },
    });
    for (const finding of open) {
      try {
        const prNumber = finding.prUrl ? prNumberFrom(finding.prUrl) : null;
        if (!finding.repo || !prNumber) continue;
        const pr = await this.github.getPullRequest(finding.repo, prNumber);
        if (!pr || pr.merged || pr.state !== 'open' || !pr.headSha) continue;

        if (pr.mergeableState === 'dirty') {
          const seen = finding.metadata?.prConflict as
            | { headSha: string }
            | undefined;
          if (seen?.headSha === pr.headSha) continue; // already decided for this head
          await this.onPrConflict(finding.id, pr.headSha);
        } else if (pr.mergeableState === 'behind') {
          const seen = finding.metadata?.prBranchUpdate as
            | { headSha: string }
            | undefined;
          if (seen?.headSha === pr.headSha) continue;
          const result = await this.github.updatePullRequestBranch(
            finding.repo,
            prNumber,
            pr.headSha,
          );
          await this.findingRepository.update(finding.id, {
            metadata: {
              ...(finding.metadata ?? {}),
              prBranchUpdate: {
                headSha: pr.headSha,
                at: new Date().toISOString(),
                updated: result.updated,
                message: result.message,
              },
            } as Record<string, any>,
          });
          await this.bugHunterService.appendFindingEvent({
            findingId: finding.id,
            repo: finding.repo,
            stage: BugHuntEventStage.PR_OPENED,
            summary: result.updated
              ? `${finding.prUrl} had fallen behind master; I asked GitHub to update its branch so CI and the Verifier read it against today's master.`
              : `${finding.prUrl} is behind master and GitHub would not update the branch: ${result.message ?? 'no reason given'}.`,
            payload: { move: 'update_branch', prUrl: finding.prUrl, ...result },
          });
        }
      } catch (error) {
        this.warn('open-PR reconcile', finding.id, error);
      }
    }
  }

  /**
   * D7 for a PR in conflict with master. Rule-owned: send a session back in
   * to rebase the branch and re-run the suite, on the same tier, once per
   * automatic-retry cap; a person after that, or when the budget is spent.
   */
  async onPrConflict(
    findingId: string,
    headSha: string,
  ): Promise<D7Pick | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (finding.status !== BugFindingStatus.PR_OPENED) return null;
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        prConflict: { headSha, at: new Date().toISOString() },
      } as Record<string, any>,
    });
    const state = stateOf(finding);
    let veto: OrchestratorVeto | null = null;
    if (state.retries >= BUG_HUNTER_D7_MAX_AUTOMATIC_RETRIES) {
      veto = {
        by: 'safety',
        reason: `I have already sent this back ${state.retries} times; a person decides`,
      };
    } else {
      veto = await this.vetoForBudget(finding);
    }
    const failures = [
      `merge conflict: the PR branch no longer merges cleanly into master (head ${headSha.slice(0, 7)})`,
    ];
    const d7 = await this.decisions.decide<D7Pick>({
      point: 'D7',
      question: 'next_move',
      repo: finding.repo ?? null,
      runId: finding.runId ?? null,
      findingId: finding.id,
      menu: [...BUG_HUNTER_D7_MENU],
      context: {
        cause: 'conflict',
        retries: state.retries,
        headSha,
        budget: finding.budget ?? null,
        fixPlan: finding.metadata?.fixPlan ?? null,
      },
      modelOwned: BUG_HUNTER_DECISION_OWNER_DEFAULTS.D7 === 'model',
      rule: () => (veto ? 'ask_human' : 'retry_fix'),
      validate: (raw) => oneOf(BUG_HUNTER_D7_MENU, raw),
      veto: veto ?? undefined,
    });
    await this.remember(finding, d7.pick);
    if (d7.pick === 'retry_fix' || d7.pick === 'escalate_model') {
      try {
        await this.fixSessionService.retry(finding, {
          kind: 'conflict',
          move: d7.pick,
          failures,
          prUrl: finding.prUrl ?? null,
          decisionId: d7.record.id,
        });
        return d7.pick;
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] D7 picked ${d7.pick} for the conflicted PR on ${finding.id} but the retry could not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await this.notificationService.notify({
      level: BugHunterNotificationLevel.ACTION_NEEDED,
      title: `My fix PR for "${clip(finding.title)}" is in conflict with master`,
      body:
        `${failures[0]}.
` +
        (veto ? `Not rebased by me because ${veto.reason}. ` : '') +
        `Rebase it yourself, ask me to try again, or close it.`,
      findingId: finding.id,
      repo: finding.repo ?? undefined,
    });
    return d7.pick === 'close' ? 'close' : 'ask_human';
  }

  // ── D4 ───────────────────────────────────────────────────────────────────

  /**
   * Records which Verifier was chosen and why. Fixed: the other vendor where
   * one exists, and today only Google is on the platform, so the menu has one
   * entry. Recorded anyway, because a decision log with a hole in it is what
   * the orchestrator exists to end.
   */
  async recordVerifierChoice(params: {
    repo: string;
    runId: string;
    findingId: string | null;
    subject: 'finding' | 'fix';
    producer: { engine: string | null; model: string | null } | null;
    counterpart: { engine: BugHunterEngine; model: string };
  }): Promise<void> {
    try {
      await this.decisions.decide({
        point: 'D4',
        question: 'verifier',
        repo: params.repo,
        runId: params.runId,
        findingId: params.findingId,
        menu: [params.counterpart],
        context: { subject: params.subject, producer: params.producer },
        modelOwned: false,
        rule: () => params.counterpart,
        validate: () => null,
        fixed: `The Verifier runs on the other vendor where one exists; only Google is on the platform today, so it runs on ${params.counterpart.engine} (${params.counterpart.model}).`,
      });
    } catch (error) {
      this.warn('D4', params.findingId ?? params.runId, error);
    }
  }

  // ── D5 ───────────────────────────────────────────────────────────────────

  /**
   * A finding the independent Verifier confirmed. Fix now, or hold it for a
   * person. Model-owned; the rule says fix. Vetoes: MANUAL mode, confidence
   * below the bar, a spent budget, and whatever the policy service refuses.
   */
  async onFindingConfirmed(
    findingId: string,
    confidence: number | null,
  ): Promise<D5Pick | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (
      finding.status !== BugFindingStatus.NEW &&
      finding.status !== BugFindingStatus.PENDING_APPROVAL
    ) {
      return null; // a person already acted
    }

    // A finding on someone's open pull request (OPP-0785): the author owns
    // the change, so the move is a review comment, not a fix session.
    if (finding.metadata?.pr) {
      const d5 = await this.decisions.decide<D5Pick>({
        point: 'D5',
        question: 'fix_now',
        repo: finding.repo ?? null,
        runId: finding.runId ?? null,
        findingId: finding.id,
        menu: [...BUG_HUNTER_D5_MENU],
        context: {
          confidence,
          pr: finding.metadata.pr,
          severity: finding.severity,
        },
        modelOwned: false,
        rule: () => 'ask_human',
        validate: (raw) => oneOf(BUG_HUNTER_D5_MENU, raw),
        fixed:
          "the finding is on an open pull request a person owns: Bug Hunter comments there and never fixes or merges someone else's change",
      });
      await this.remember(finding, 'ask_human');
      try {
        await this.prReview.commentForFinding(finding);
      } catch (error) {
        this.warn('comment on PR', finding.id, error);
      }
      void d5;
      return 'ask_human';
    }

    const veto = await this.vetoForFix(finding, confidence);
    const d5 = await this.decisions.decide<D5Pick>({
      point: 'D5',
      question: 'fix_now',
      repo: finding.repo ?? null,
      runId: finding.runId ?? null,
      findingId: finding.id,
      menu: [...BUG_HUNTER_D5_MENU],
      context: {
        confidence,
        severity: finding.severity,
        source: finding.source,
        proven: finding.proven,
        touchesGuardedPath: finding.touchesGuardedPath,
        budget: finding.budget ?? null,
        title: finding.title,
      },
      modelOwned: BUG_HUNTER_DECISION_OWNER_DEFAULTS.D5 === 'model',
      rule: () => (veto ? 'ask_human' : 'fix'),
      validate: (raw) => oneOf(BUG_HUNTER_D5_MENU, raw),
      veto: veto ?? undefined,
    });

    await this.remember(finding, d5.pick === 'fix' ? 'fix' : 'ask_human');
    if (d5.pick === 'fix') {
      try {
        await this.fixSessionService.startByAgent(finding.id, 'verifier');
        return 'fix';
      } catch (error) {
        this.logger.info(
          `[BUG_HUNTER] D5 picked fix for ${finding.id} but no session could start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (finding.status === BugFindingStatus.NEW) {
      await this.bugFindingService.setStatus(finding.id, {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
    }
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo ?? null,
      stage: BugHuntEventStage.ESCALATED,
      summary: veto
        ? `Held for you: ${veto.reason}`
        : `Held for you: ${d5.reason || 'the orchestrator chose not to fix this automatically'}.`,
      payload: {
        move: 'ask_human',
        point: 'D5',
        veto,
        decisionId: d5.record.id,
      },
    });
    return 'ask_human';
  }

  // ── D7 ───────────────────────────────────────────────────────────────────

  /**
   * The Verifier refused a fix. Rule-owned: the first refusal gets a retry
   * on the same tier with the named failures in hand; the second goes to
   * the strong tier; after that a person. Vetoes: a diff that did more than
   * asked, a guarded path, a spent budget.
   */
  async onFixRefused(
    findingId: string,
    verdict: BugFixVerdict,
    failures: string[],
  ): Promise<D7Pick | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (finding.status !== BugFindingStatus.PR_OPENED) return null;

    const refusals = (
      Array.isArray(finding.metadata?.fixVerdicts)
        ? (finding.metadata!.fixVerdicts as BugFixVerdict[])
        : []
    ).filter((v) => v.verdict === 'fail').length;
    const state = stateOf(finding);

    let veto: OrchestratorVeto | null = null;
    if (verdict.scopeExceeded) {
      veto = {
        by: 'safety',
        reason: 'the diff did more than the brief asked; a person reads it',
      };
    } else if (finding.touchesGuardedPath) {
      veto = {
        by: 'safety',
        reason:
          'this fix touches a guarded path; a person decides the next move',
      };
    } else if (state.retries >= BUG_HUNTER_D7_MAX_AUTOMATIC_RETRIES) {
      veto = {
        by: 'safety',
        reason: `I have already sent this back ${state.retries} times; a person decides`,
      };
    } else {
      veto = await this.vetoForBudget(finding);
    }

    const d7 = await this.decisions.decide<D7Pick>({
      point: 'D7',
      question: 'next_move',
      repo: finding.repo ?? null,
      runId: verdict.runId ?? finding.runId ?? null,
      findingId: finding.id,
      menu: [...BUG_HUNTER_D7_MENU],
      context: {
        cause: 'verifier_fail',
        refusals,
        retries: state.retries,
        failures: failures.slice(0, 6),
        scopeExceeded: verdict.scopeExceeded,
        touchesGuardedPath: finding.touchesGuardedPath,
        budget: finding.budget ?? null,
        fixPlan: finding.metadata?.fixPlan ?? null,
      },
      modelOwned: BUG_HUNTER_DECISION_OWNER_DEFAULTS.D7 === 'model',
      rule: () =>
        veto ? 'ask_human' : refusals <= 1 ? 'retry_fix' : 'escalate_model',
      validate: (raw) => oneOf(BUG_HUNTER_D7_MENU, raw),
      veto: veto ?? undefined,
    });

    await this.remember(finding, d7.pick);
    if (d7.pick === 'retry_fix' || d7.pick === 'escalate_model') {
      try {
        await this.fixSessionService.retry(finding, {
          kind: 'verifier_fail',
          move: d7.pick,
          failures,
          prUrl: finding.prUrl ?? null,
          decisionId: d7.record.id,
        });
        return d7.pick;
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] D7 picked ${d7.pick} for ${finding.id} but the retry could not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    await this.notificationService.notify({
      level: BugHunterNotificationLevel.ACTION_NEEDED,
      title: `Verifier refused my fix for "${clip(finding.title)}"`,
      body:
        `${failures
          .slice(0, 4)
          .map((f) => `• ${f}`)
          .join('\n')}\n` +
        (veto
          ? `Not retried by me because ${veto.reason}. `
          : d7.pick === 'close'
            ? 'I think this PR should be closed. '
            : '') +
        `The PR is still open. Ask me to try again with these failures in hand, fix it yourself, or close it.`,
      findingId: finding.id,
      runId: verdict.runId ?? undefined,
      repo: finding.repo ?? undefined,
    });
    return d7.pick === 'close' ? 'close' : 'ask_human';
  }

  /**
   * A fix session failed and left its post-mortem. Rule-owned: one retry on
   * the strong tier with the post-mortem in the brief, then a person.
   * Called after the session's own `failed` PATCH has landed, so the
   * notification about the failure has already gone out; a retry adds an
   * event saying so.
   */
  async onSessionFailed(findingId: string): Promise<D7Pick | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (finding.status !== BugFindingStatus.FAILED) return null;
    if (!finding.repo || !repoCommands(finding.repo)?.fixable) return null;
    const state = stateOf(finding);

    let veto: OrchestratorVeto | null = null;
    if (state.retries >= 1) {
      veto = {
        by: 'safety',
        reason: `I already retried this once after a failure; a person decides`,
      };
    } else {
      veto = await this.vetoForBudget(finding);
    }

    const postmortem = (finding.metadata?.postmortem ?? null) as Record<
      string,
      unknown
    > | null;
    const d7 = await this.decisions.decide<D7Pick>({
      point: 'D7',
      question: 'next_move',
      repo: finding.repo ?? null,
      runId: finding.runId ?? null,
      findingId: finding.id,
      menu: [...BUG_HUNTER_D7_MENU],
      context: {
        cause: 'session_failed',
        retries: state.retries,
        postmortem: postmortem
          ? {
              failingCheck: postmortem.failingCheck ?? null,
              whyItFailed: String(postmortem.whyItFailed ?? '').slice(0, 300),
              tryNext: String(postmortem.tryNext ?? '').slice(0, 300),
            }
          : null,
        budget: finding.budget ?? null,
        fixPlan: finding.metadata?.fixPlan ?? null,
      },
      modelOwned: BUG_HUNTER_DECISION_OWNER_DEFAULTS.D7 === 'model',
      rule: () => (veto ? 'ask_human' : 'escalate_model'),
      validate: (raw) => oneOf(BUG_HUNTER_D7_MENU, raw),
      veto: veto ?? undefined,
    });

    await this.remember(finding, d7.pick);
    if (d7.pick === 'retry_fix' || d7.pick === 'escalate_model') {
      try {
        await this.fixSessionService.retry(finding, {
          kind: 'session_failed',
          move: d7.pick,
          failures: postmortem?.lastFailure
            ? [String(postmortem.lastFailure).slice(0, 300)]
            : [],
          prUrl: null,
          decisionId: d7.record.id,
        });
        return d7.pick;
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] D7 picked ${d7.pick} after a failed session on ${finding.id} but the retry could not start: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return 'ask_human';
  }

  // ── D8 ───────────────────────────────────────────────────────────────────

  /**
   * Records the merge gate's answer for a verified fix. Fixed: policy plus
   * a Verify pass decide, and no setting can hand this to a model.
   */
  async recordMergeGate(params: {
    finding: BugFinding;
    verdict: BugFixVerdict;
    allowed: boolean;
    reason: string;
  }): Promise<void> {
    try {
      const pick: D8Pick = params.allowed ? 'merge' : 'ask_human';
      await this.decisions.decide<D8Pick>({
        point: 'D8',
        question: 'merge',
        repo: params.finding.repo ?? null,
        runId: params.verdict.runId ?? null,
        findingId: params.finding.id,
        menu: [...BUG_HUNTER_D8_MENU],
        context: {
          verdict: params.verdict.verdict,
          scopeExceeded: params.verdict.scopeExceeded,
          touchesGuardedPath: params.finding.touchesGuardedPath,
          prUrl: params.finding.prUrl ?? null,
        },
        modelOwned: false,
        rule: () => pick,
        validate: () => null,
        fixed: params.reason,
      });
      await this.remember(
        params.finding,
        pick === 'merge' ? 'close' : 'ask_human',
      );
    } catch (error) {
      this.warn('D8', params.finding.id, error);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private async vetoForFix(
    finding: BugFinding,
    confidence: number | null,
  ): Promise<OrchestratorVeto | null> {
    const settings = await this.bugHunterService.getSettings();
    if (settings.mode !== BugHunterMode.AI) {
      return {
        by: 'mode',
        reason: `Bug Hunter is in ${settings.mode.toUpperCase()} mode, where a person approves every fix`,
      };
    }
    if (confidence != null && confidence < BUG_HUNT_LOW_CONFIDENCE_THRESHOLD) {
      return {
        by: 'safety',
        reason: `confidence ${confidence.toFixed(2)} is below the ${BUG_HUNT_LOW_CONFIDENCE_THRESHOLD} bar`,
      };
    }
    try {
      await this.policyService.assertMayFix(finding);
    } catch (error) {
      return {
        by: 'safety',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    return this.vetoForBudget(finding);
  }

  private async vetoForBudget(
    finding: BugFinding,
  ): Promise<OrchestratorVeto | null> {
    try {
      await this.budgetService.assertCanStartSession(finding, {
        force: false,
        userId: null,
      });
      return null;
    } catch (error) {
      return {
        by: 'budget',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Keeps `metadata.orchestrator` current: the move count and the last move. */
  private async remember(
    finding: BugFinding,
    move: BugHunterMove,
  ): Promise<void> {
    const prior = stateOf(finding);
    const next: OrchestratorState = {
      retries:
        prior.retries +
        (move === 'retry_fix' || move === 'escalate_model' ? 1 : 0),
      lastMove: move,
      lastMoveAt: new Date().toISOString(),
    };
    try {
      const fresh = await this.findingRepository.findOne({
        where: { id: finding.id },
        select: ['id', 'metadata'],
      });
      await this.findingRepository.update(finding.id, {
        metadata: {
          ...(fresh?.metadata ?? finding.metadata ?? {}),
          orchestrator: next,
        } as Record<string, any>,
      });
      finding.metadata = { ...(finding.metadata ?? {}), orchestrator: next };
    } catch (error) {
      this.warn('state', finding.id, error);
    }
  }

  private warn(what: string, id: string, error: unknown): void {
    this.logger.warn(
      `[BUG_HUNTER] Orchestrator ${what} on ${id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function oneOf<T extends string>(menu: readonly T[], raw: unknown): T | null {
  return typeof raw === 'string' && (menu as readonly string[]).includes(raw)
    ? (raw as T)
    : null;
}

const clip = (s: string): string => (s.length > 80 ? `${s.slice(0, 77)}…` : s);
