import { Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_FIX_SESSION_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { repoCommands } from '../constants/bug-hunt-repos.constants';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugFindingStatus } from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import {
  BugFixVerdict,
  latestVerdictFor,
  namedFailures,
  toBugFixVerdict,
} from '../type/bug-fix-verdict.type';
import {
  BugHunterModelSettings,
  BugHunterEngine,
} from '../type/bug-hunter-model-settings.type';
import { BugFindingService } from './bug-finding.service';
import { BugHunterService } from './bug-hunter.service';
import { BugHunterNotificationService } from './bug-hunter-notification.service';
import {
  BugHunterPolicyService,
  prNumberFrom,
} from './bug-hunter-policy.service';
import { BugHunterModelSettingsService } from './bug-hunter-model-settings.service';
import { BugFixSessionService } from './bug-fix-session.service';

/**
 * What the verifier run needs to know about itself, stored on the finding at
 * dispatch so the models endpoint can hand the workflow the right engine.
 */
export interface VerifyFixDispatch {
  runId: string;
  prUrl: string;
  prNumber: number;
  prHeadSha: string | null;
  fixEngine: string | null;
  fixModel: string | null;
  counterpart: { engine: BugHunterEngine; model: string };
  dispatchedAt: string;
}

/**
 * The other vendor. A verifier on the same model family as the fixer shares
 * its blind spots, so the pairing is forced: Claude reads a Gemini-made fix
 * and Gemini reads a Claude-made one. OpenCode is a shell around one of the
 * two, so it is classified by the model it ran. Claude Code is kept as an
 * engine for exactly this (decided 2026-10-07): Gemini and OpenCode do the
 * bulk of the work, and the second opinion is where another vendor earns
 * its cost.
 */
export function counterpartFor(
  fixEngine: string | null,
  fixModel: string | null,
  settings: BugHunterModelSettings,
): { engine: BugHunterEngine; model: string } {
  const fixVendor =
    vendorOf(fixEngine, fixModel) ??
    vendorOf(settings.engine, settings.defaultModel);
  return fixVendor === 'anthropic'
    ? { engine: 'gemini', model: 'gemini-2.5-pro' }
    : { engine: 'claude-code', model: 'claude-sonnet-5' };
}

function vendorOf(
  engine: string | null,
  model: string | null,
): 'anthropic' | 'google' | null {
  if (model?.startsWith('claude')) return 'anthropic';
  if (model?.startsWith('gemini')) return 'google';
  if (engine === 'claude-code') return 'anthropic';
  if (engine === 'gemini') return 'google';
  return null;
}

/**
 * The Verifier stage for fixes — OPP-0779. See `BugFixVerdict` for why.
 *
 * Three moments:
 *  1. `dispatch` — a fix reached PR_OPENED. Open a `verify_fix` run on the
 *     other vendor and hand the workflow the PR.
 *  2. `recordVerdict` — the verifier PATCHed its checks. Validate, compute
 *     pass or fail, store on the case file, post on the PR.
 *  3. `actOnVerdict` — pass and policy allows a self-merge: merge. Pass but
 *     policy wants a person: say so. Fail: say so, with the named failures;
 *     the retry is the admin's call until the orchestrator (OPP-0783) owns it.
 */
@Injectable()
export class BugVerifyFixService {
  private readonly logger = LoggerService.getInstance(BugVerifyFixService.name);

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly bugFindingService: BugFindingService,
    private readonly bugHunterService: BugHunterService,
    private readonly github: GithubActionsService,
    private readonly notificationService: BugHunterNotificationService,
    private readonly policyService: BugHunterPolicyService,
    private readonly fixSessionService: BugFixSessionService,
    private readonly modelSettingsService: BugHunterModelSettingsService,
    private readonly configService: AppConfigService,
  ) {}

  /** Best-effort: a verifier that cannot be dispatched leaves the PR open for a person, which is what happened before this existed. */
  async dispatch(findingId: string): Promise<VerifyFixDispatch | null> {
    try {
      const finding = await this.bugFindingService.getOne(findingId);
      if (finding.status !== BugFindingStatus.PR_OPENED) return null;
      if (!finding.repo || !finding.prUrl) return null;
      const commands = repoCommands(finding.repo);
      if (!commands?.fixable) return null;
      const prNumber = prNumberFrom(finding.prUrl);
      if (!prNumber) return null;

      const pr = await this.github.getPullRequest(finding.repo, prNumber);
      const headSha = pr?.headSha ?? null;
      const existing = latestVerdictFor(
        finding.metadata?.fixVerdicts,
        finding.prUrl,
        headSha,
      );
      if (existing) return null; // this head has its verdict already
      const pending = finding.metadata?.verifyFix as
        | VerifyFixDispatch
        | undefined;
      if (pending && pending.prHeadSha === headSha && pending.prHeadSha) {
        return null; // a verifier is already on this head
      }

      const fixRun = finding.runId
        ? await this.bugHunterService.getRun(finding.runId).catch(() => null)
        : null;
      const settings = await this.modelSettingsService.get();
      const counterpart = counterpartFor(
        fixRun?.engine ?? null,
        fixRun?.model ?? null,
        settings,
      );

      const run = await this.bugHunterService.startRun(
        BugHuntTrigger.VERIFY_FIX,
        finding.repo,
      );
      const dispatched: VerifyFixDispatch = {
        runId: run.id,
        prUrl: finding.prUrl,
        prNumber,
        prHeadSha: headSha,
        fixEngine: fixRun?.engine ?? null,
        fixModel: fixRun?.model ?? null,
        counterpart,
        dispatchedAt: new Date().toISOString(),
      };
      // Stored before the dispatch so the workflow's very first call —
      // `GET pipeline/models?role=verify_fix` — can read the counterpart.
      await this.findingRepository.update(finding.id, {
        metadata: {
          ...(finding.metadata ?? {}),
          verifyFix: dispatched,
        } as Record<string, any>,
      });

      try {
        await this.github.dispatchWorkflow({
          repo: finding.repo,
          workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
          ref: BUG_FIX_SESSION_DEFAULT_REF,
          inputs: {
            finding_id: finding.id,
            run_id: run.id,
            repo: finding.repo,
            api_base_url: this.configService.publicApiBaseUrl,
            mode: 'verify',
          },
        });
      } catch (error) {
        await this.bugHunterService.closeRun(
          run.id,
          BugHuntRunStatus.FAILED,
          {
            foundCount: 0,
            autoMergedCount: 0,
            prOpenedCount: 0,
            dismissedCount: 0,
          },
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }

      await this.bugHunterService.appendEvent({
        runId: run.id,
        repo: finding.repo,
        findingId: finding.id,
        stage: BugHuntEventStage.VERIFY,
        summary: `Verifier dispatched on ${counterpart.engine} (${counterpart.model}) to read ${finding.prUrl}${
          fixRun?.engine ? ` — the fix was written on ${fixRun.engine}` : ''
        }.`,
        payload: { kind: 'fix', dispatched },
      });
      return dispatched;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not dispatch a verifier for finding ${findingId}; the PR stays open for a person: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** The verifier's PATCH. Returns the stored verdict, or null when the report was unusable. */
  async recordVerdict(
    findingId: string,
    raw: Record<string, unknown>,
  ): Promise<BugFixVerdict | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    const pending = (finding.metadata?.verifyFix ??
      null) as VerifyFixDispatch | null;
    const runId =
      typeof raw.runId === 'string' ? raw.runId : (pending?.runId ?? null);
    const run = runId
      ? await this.bugHunterService.getRun(runId).catch(() => null)
      : null;
    const verdict = toBugFixVerdict(raw, {
      by: {
        engine: run?.engine ?? pending?.counterpart.engine ?? null,
        model: run?.model ?? pending?.counterpart.model ?? null,
      },
      prUrl:
        typeof raw.prUrl === 'string' ? raw.prUrl : (finding.prUrl ?? null),
      prHeadSha:
        typeof raw.prHeadSha === 'string'
          ? raw.prHeadSha
          : (pending?.prHeadSha ?? null),
      runId,
    });
    if (!verdict) {
      this.logger.warn(
        `[BUG_HUNTER] Verifier report for finding ${findingId} had no checks; nothing recorded.`,
      );
      return null;
    }

    const verdicts = Array.isArray(finding.metadata?.fixVerdicts)
      ? (finding.metadata!.fixVerdicts as BugFixVerdict[])
      : [];
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        fixVerdicts: [...verdicts, verdict],
        verifyFix: null,
      } as Record<string, any>,
    });
    const failures = namedFailures(verdict);
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo,
      stage: BugHuntEventStage.VERIFY,
      summary:
        verdict.verdict === 'pass'
          ? `Verifier passed the fix${verdict.summary ? `: ${verdict.summary}` : ''}`
          : `Verifier refused the fix: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? ` (+${failures.length - 3} more)` : ''}`,
      payload: { kind: 'fix', verdict },
    });

    await this.commentOnPr(finding, verdict, failures);
    await this.actOnVerdict(finding, verdict, failures);
    return verdict;
  }

  private async actOnVerdict(
    finding: BugFinding,
    verdict: BugFixVerdict,
    failures: string[],
  ): Promise<void> {
    const fresh = await this.bugFindingService.getOne(finding.id);
    if (fresh.status !== BugFindingStatus.PR_OPENED) return; // a person already acted

    if (verdict.verdict === 'fail') {
      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        title: `Verifier refused my fix for "${clip(fresh.title)}"`,
        body:
          `${failures
            .slice(0, 4)
            .map((f) => `• ${f}`)
            .join('\n')}\n` +
          `The PR is still open. Ask me to try again with these failures in hand, fix it yourself, or close it.`,
        findingId: fresh.id,
        runId: verdict.runId ?? undefined,
        repo: fresh.repo ?? undefined,
      });
      return;
    }

    // A pass. Merge only where policy already allowed a self-merge; the
    // Verifier adds a gate, it never opens one.
    try {
      await this.policyService.assertMayMerge(fresh, fresh.prUrl ?? null, {
        verified: true,
      });
    } catch (error) {
      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        title: `Verified and ready for your merge: "${clip(fresh.title)}"`,
        body:
          `${verdict.summary ?? 'Every check passed.'}\n` +
          `Not merged by me because: ${error instanceof Error ? error.message : String(error)}`,
        findingId: fresh.id,
        runId: verdict.runId ?? undefined,
        repo: fresh.repo ?? undefined,
      });
      return;
    }

    try {
      await this.fixSessionService.mergeVerifiedFinding(fresh, verdict);
    } catch (error) {
      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        title: `Verified, but I could not merge "${clip(fresh.title)}"`,
        body: error instanceof Error ? error.message : String(error),
        findingId: fresh.id,
        runId: verdict.runId ?? undefined,
        repo: fresh.repo ?? undefined,
      });
    }
  }

  private async commentOnPr(
    finding: BugFinding,
    verdict: BugFixVerdict,
    failures: string[],
  ): Promise<void> {
    if (!finding.repo || !finding.prUrl) return;
    const prNumber = prNumberFrom(finding.prUrl);
    if (!prNumber) return;
    const lines = [
      `### Bug Hunter Verifier: ${verdict.verdict === 'pass' ? 'PASS' : 'FAIL'}`,
      verdict.by.engine
        ? `_Independent read on ${verdict.by.engine}${verdict.by.model ? ` (${verdict.by.model})` : ''}${verdict.prHeadSha ? `, head ${verdict.prHeadSha.slice(0, 7)}` : ''}._`
        : '',
      verdict.summary ? `\n${verdict.summary}` : '',
      '',
      '| Check | Result | Evidence |',
      '|---|---|---|',
      ...verdict.checks.map(
        (c) =>
          `| ${c.name} | ${c.skipped ? `skipped (${c.skipped})` : c.ok ? 'ok' : 'FAIL'} | ${(c.evidence ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300)} |`,
      ),
      verdict.scopeExceeded
        ? '\n**Scope exceeded**: the diff does more than the brief asked.'
        : '',
      failures.length && verdict.verdict === 'fail'
        ? `\n**Named failures**\n${failures.map((f) => `- ${f}`).join('\n')}`
        : '',
      verdict.wouldBeWrongIf
        ? `\n_This verdict is wrong if: ${verdict.wouldBeWrongIf}_`
        : '',
    ].filter((l) => l !== '');
    try {
      await this.github.createIssueComment(
        finding.repo,
        prNumber,
        lines.join('\n'),
      );
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not post the verdict on ${finding.prUrl}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const clip = (s: string): string => (s.length > 90 ? `${s.slice(0, 87)}…` : s);
