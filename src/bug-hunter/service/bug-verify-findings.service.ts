import { Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_FIX_SESSION_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { repoCommands } from '../constants/bug-hunt-repos.constants';
import { repairableDataFault } from '../constants/bug-hunter-repair';
import {
  BUG_FINDING_LOCATE_STATUSES,
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
} from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import {
  BugFindingVerdict,
  isDataFault,
  toBugFindingVerdict,
} from '../type/bug-finding-verdict.type';
import { BugHunterNotificationService } from './bug-hunter-notification.service';
import { BugHunterNotificationLevel } from '../enum/bug-hunter-notification.enum';
import {
  faultIsNotCode,
  fixDidNotHoldInProduction,
} from '../constants/bug-hunter-voice';
import { BugHunterWrongFixService } from './bug-hunter-wrong-fix.service';
import { BugHunterEngine } from '../type/bug-hunter-model-settings.type';
import { BugFindingService } from './bug-finding.service';
import { BugFixSessionService } from './bug-fix-session.service';
import { BugHunterModelSettingsService } from './bug-hunter-model-settings.service';
import { BugHunterOrchestratorService } from './bug-hunter-orchestrator.service';
import { BugHunterPolicyService } from './bug-hunter-policy.service';
import { BugHunterService } from './bug-hunter.service';
import { verifierFor } from './bug-verify-fix.service';

/** Stored on the verify run's metadata, so the workflow's models call can read the counterpart. */
export interface VerifyFindingsDispatch {
  sweepRunId: string;
  findingIds: string[];
  sweepEngine: string | null;
  sweepModel: string | null;
  counterpart: { engine: BugHunterEngine; model: string };
  dispatchedAt: string;
  /** A post-release check (link six), not a verdict on whether the bug is real. */
  heldCheck?: boolean;
}

/**
 * The Verifier stage for findings — OPP-0780. See `BugFindingVerdict`.
 *
 *  1. `dispatchForRun` — a sweep closed. Every unproven finding it kept goes
 *     to one `verify_findings` run on Gemini, marked `pending`.
 *  2. `recordVerdict` — the verifier PATCHed a finding. Store it, then act:
 *     refuted → dismissed with the refutation; unsure → held for a person;
 *     confirmed → in AI mode and above the confidence bar, a fix session.
 */
@Injectable()
export class BugVerifyFindingsService {
  private readonly logger = LoggerService.getInstance(
    BugVerifyFindingsService.name,
  );

  constructor(
    private readonly findingRepository: BugFindingRepository,
    private readonly bugFindingService: BugFindingService,
    private readonly bugHunterService: BugHunterService,
    private readonly github: GithubActionsService,
    private readonly policyService: BugHunterPolicyService,
    private readonly fixSessionService: BugFixSessionService,
    private readonly modelSettingsService: BugHunterModelSettingsService,
    private readonly configService: AppConfigService,
    private readonly orchestrator: BugHunterOrchestratorService,
    private readonly notificationService: BugHunterNotificationService,
    private readonly wrongFixService: BugHunterWrongFixService,
  ) {}

  /** Best-effort: a verifier that cannot be dispatched leaves the findings pending, which is the safe side. */
  async dispatchForRun(
    sweepRunId: string,
  ): Promise<VerifyFindingsDispatch | null> {
    try {
      const sweep = await this.bugHunterService.getRun(sweepRunId);
      if (
        sweep.trigger !== BugHuntTrigger.SCHEDULED &&
        sweep.trigger !== BugHuntTrigger.MANUAL &&
        sweep.trigger !== BugHuntTrigger.PR_REVIEW
      ) {
        return null;
      }
      const commands = repoCommands(sweep.repo);
      if (!commands?.fixable) return null;

      const candidates = (
        await this.findingRepository.find({
          where: {
            runId: sweep.id,
            status: BugFindingStatus.NEW,
            proven: false,
          },
        })
      ).filter(
        (f) =>
          f.source !== BugFindingSource.REPORTED_BUG &&
          !f.metadata?.independentVerification,
      );
      if (!candidates.length) return null;

      const settings = await this.modelSettingsService.get();
      const counterpart = verifierFor(settings);
      const run = await this.bugHunterService.startRun(
        BugHuntTrigger.VERIFY_FINDINGS,
        sweep.repo,
      );
      const dispatched: VerifyFindingsDispatch = {
        sweepRunId: sweep.id,
        findingIds: candidates.map((f) => f.id),
        sweepEngine: sweep.engine ?? null,
        sweepModel: sweep.model ?? null,
        counterpart,
        dispatchedAt: new Date().toISOString(),
      };
      await this.bugHunterService.setRunMetadata(run.id, {
        verifyFindings: dispatched,
      });
      // D4 (OPP-0783): which Verifier — fixed by rule, recorded all the same.
      void this.orchestrator.recordVerifierChoice({
        repo: sweep.repo,
        runId: run.id,
        findingId: null,
        subject: 'finding',
        producer: { engine: sweep.engine ?? null, model: sweep.model ?? null },
        counterpart,
      });
      for (const f of candidates) {
        await this.findingRepository.update(f.id, {
          metadata: {
            ...(f.metadata ?? {}),
            independentVerification: 'pending',
            verifyFindingsRunId: run.id,
          } as Record<string, any>,
        });
      }

      try {
        await this.github.dispatchWorkflow({
          repo: sweep.repo,
          workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
          ref: BUG_FIX_SESSION_DEFAULT_REF,
          inputs: {
            // The verify-findings run has no single finding; the workflow's
            // finding_id carries the verify run id so its models call can
            // read the counterpart from this run's metadata.
            finding_id: run.id,
            run_id: run.id,
            repo: sweep.repo,
            api_base_url: this.configService.publicApiBaseUrl,
            mode: 'verify_findings',
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
        for (const f of candidates) {
          await this.findingRepository.update(f.id, {
            metadata: {
              ...(f.metadata ?? {}),
              independentVerification: null,
              verifyFindingsRunId: null,
            } as Record<string, any>,
          });
        }
        throw error;
      }

      await this.bugHunterService.appendEvent({
        runId: run.id,
        repo: sweep.repo,
        stage: BugHuntEventStage.VERIFY,
        summary: `Independent verifier dispatched on ${counterpart.engine} (${counterpart.model}) for ${candidates.length} unproven finding${candidates.length === 1 ? '' : 's'} from the sweep${sweep.engine ? ` that ran on ${sweep.engine}` : ''}.`,
        payload: { kind: 'findings', dispatched },
      });
      return dispatched;
    } catch (error) {
      this.logger.warn(
        `[BUG_HUNTER] Could not dispatch the finding verifier for sweep ${sweepRunId}; its findings stay pending for a person: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Locate before fixing: one Verifier run for ONE human report, as soon as
   * the report has a repo — from the Finder's five-minute trigger, or from an
   * admin pressing "Put me on it" on a report nobody has located yet. The
   * brief tells the Verifier to probe production and name the layer at
   * fault; a confirmed code fault then goes to D5 like any sweep finding, a
   * data or config fault goes to a person with the repair, and a fix session
   * never starts from the symptom alone. Returns null when nothing was
   * dispatched (already judged or pending, no repo, repo not fixable).
   */
  async dispatchForReport(
    findingId: string,
  ): Promise<VerifyFindingsDispatch | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (finding.source !== BugFindingSource.REPORTED_BUG) return null;
    // A plan step inherits its parent's source; the plan, not locate-first, drives it.
    if (finding.parentFindingId) return null;
    if (!BUG_FINDING_LOCATE_STATUSES.includes(finding.status)) return null;
    // Pending: a Verifier is on it. Confirmed: the fault is already named,
    // and the fix session reads it. Unsure or never judged: locate (again) —
    // an admin pressing "Put me on it" after a wrong fix, or after rewriting
    // the brief, wants the fault found, not the symptom fixed a second time.
    const judged = finding.metadata?.independentVerification;
    if (judged === 'pending' || judged === 'confirmed') return null;
    const repo = finding.repo;
    const commands = repo ? repoCommands(repo) : null;
    if (!repo || !commands?.fixable) return null;

    const settings = await this.modelSettingsService.get();
    const counterpart = verifierFor(settings);
    const run = await this.bugHunterService.startRun(
      BugHuntTrigger.VERIFY_FINDINGS,
      repo,
    );
    const dispatched: VerifyFindingsDispatch = {
      sweepRunId: finding.runId ?? run.id,
      findingIds: [finding.id],
      sweepEngine: null,
      sweepModel: null,
      counterpart,
      dispatchedAt: new Date().toISOString(),
    };
    await this.bugHunterService.setRunMetadata(run.id, {
      verifyFindings: dispatched,
    });
    void this.orchestrator.recordVerifierChoice({
      repo,
      runId: run.id,
      findingId: finding.id,
      subject: 'finding',
      producer: { engine: null, model: null },
      counterpart,
    });
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        independentVerification: 'pending',
        verifyFindingsRunId: run.id,
      } as Record<string, any>,
    });
    try {
      await this.github.dispatchWorkflow({
        repo,
        workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
        ref: BUG_FIX_SESSION_DEFAULT_REF,
        inputs: {
          finding_id: run.id,
          run_id: run.id,
          repo,
          api_base_url: this.configService.publicApiBaseUrl,
          mode: 'verify_findings',
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
      await this.findingRepository.update(finding.id, {
        metadata: {
          ...(finding.metadata ?? {}),
          independentVerification: null,
          verifyFindingsRunId: null,
        } as Record<string, any>,
      });
      throw error;
    }
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo,
      stage: BugHuntEventStage.VERIFY,
      summary: `Locating the fault before any fix: an independent verifier on ${counterpart.engine} (${counterpart.model}) is reproducing this report against production and will say whether the fault is in code, data or configuration.`,
      payload: { kind: 'findings', dispatched, locateFirst: true },
    });
    return dispatched;
  }

  /**
   * Link six, held after release (see BugHunterHeldWatchService): one
   * Verifier run that re-runs the reporter's steps against production an
   * hour after the release and says whether the symptom is gone. Nothing
   * is fixed and nothing merges from this run; it only closes the loop.
   */
  async dispatchHeldCheck(
    findingId: string,
  ): Promise<VerifyFindingsDispatch | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (finding.status !== BugFindingStatus.RELEASED) return null;
    if (finding.metadata?.heldInProduction || finding.metadata?.heldCheckRunId)
      return null;
    const repo = finding.repo;
    const commands = repo ? repoCommands(repo) : null;
    if (!repo || !commands?.fixable) return null;

    const settings = await this.modelSettingsService.get();
    const counterpart = verifierFor(settings);
    const run = await this.bugHunterService.startRun(
      BugHuntTrigger.VERIFY_FINDINGS,
      repo,
    );
    const dispatched: VerifyFindingsDispatch = {
      sweepRunId: finding.runId ?? run.id,
      findingIds: [finding.id],
      sweepEngine: null,
      sweepModel: null,
      counterpart,
      dispatchedAt: new Date().toISOString(),
      heldCheck: true,
    };
    await this.bugHunterService.setRunMetadata(run.id, {
      verifyFindings: dispatched,
    });
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        heldCheckRunId: run.id,
      } as Record<string, any>,
    });
    try {
      await this.github.dispatchWorkflow({
        repo,
        workflow: BUG_FIX_SESSION_WORKFLOW_FILE,
        ref: BUG_FIX_SESSION_DEFAULT_REF,
        inputs: {
          finding_id: run.id,
          run_id: run.id,
          repo,
          api_base_url: this.configService.publicApiBaseUrl,
          mode: 'verify_findings',
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
      await this.findingRepository.update(finding.id, {
        metadata: {
          ...(finding.metadata ?? {}),
          heldCheckRunId: null,
        } as Record<string, any>,
      });
      throw error;
    }
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo,
      stage: BugHuntEventStage.VERIFY,
      summary: `Checking that the fix held: an independent verifier on ${counterpart.engine} (${counterpart.model}) is re-running the reporter's steps against production.`,
      payload: { kind: 'held', dispatched },
    });
    return dispatched;
  }

  /** The held check's PATCH: the symptom gone or back in production, with what was seen. */
  async recordHeldCheck(
    findingId: string,
    raw: Record<string, unknown>,
  ): Promise<{ ok: boolean; evidence: string | null } | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    if (typeof raw.held !== 'boolean') {
      this.logger.warn(
        `[BUG_HUNTER] Held check for ${findingId} did not say held true or false; nothing recorded.`,
      );
      return null;
    }
    const evidence =
      typeof raw.evidence === 'string' && raw.evidence.trim()
        ? raw.evidence.trim().slice(0, 1200)
        : null;
    const result = {
      ok: raw.held,
      evidence,
      at: new Date().toISOString(),
      runId:
        typeof raw.runId === 'string'
          ? raw.runId
          : (finding.metadata?.heldCheckRunId ?? null),
    };
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        heldInProduction: result,
      } as Record<string, any>,
    });
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo,
      stage: BugHuntEventStage.VERIFY,
      summary: result.ok
        ? `The fix held: the reporter's steps no longer show the symptom in production${evidence ? ` (${clip(evidence)})` : ''}.`
        : `The fix did not hold: the symptom is back in production${evidence ? ` (${clip(evidence)})` : ''}.`,
      payload: { kind: 'held', result },
    });
    if (!result.ok) {
      await this.wrongFixService.record(
        finding,
        {
          link: 'held',
          source: 'held_check',
          reason: evidence ?? 'the symptom is back in production',
          prUrl: finding.prUrl ?? null,
          sha: null,
          by: null,
        },
        { reopen: true },
      );
      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        ...fixDidNotHoldInProduction(finding.title, finding.repo, evidence),
        findingId: finding.id,
        runId: result.runId ?? undefined,
        repo: finding.repo,
      });
    }
    return { ok: result.ok, evidence };
  }

  /** The verifier's PATCH for one finding. Returns the stored verdict, or null when unusable. */
  async recordVerdict(
    findingId: string,
    raw: Record<string, unknown>,
  ): Promise<BugFindingVerdict | null> {
    const finding = await this.bugFindingService.getOne(findingId);
    const runId =
      typeof raw.runId === 'string'
        ? raw.runId
        : (finding.metadata?.verifyFindingsRunId ?? null);
    const run = runId
      ? await this.bugHunterService.getRun(runId).catch(() => null)
      : null;
    const dispatched = run?.metadata?.verifyFindings as
      | VerifyFindingsDispatch
      | undefined;
    const verdict = toBugFindingVerdict(raw, {
      by: {
        engine: run?.engine ?? dispatched?.counterpart.engine ?? null,
        model: run?.model ?? dispatched?.counterpart.model ?? null,
      },
      runId,
      reported: finding.source === BugFindingSource.REPORTED_BUG,
    });
    if (!verdict) {
      this.logger.warn(
        `[BUG_HUNTER] Finding verdict for ${findingId} was unusable; nothing recorded.`,
      );
      return null;
    }

    const prior = Array.isArray(finding.metadata?.findingVerdicts)
      ? (finding.metadata!.findingVerdicts as BugFindingVerdict[])
      : [];
    // The lower of the sweep's own score and the independent one: a finding
    // is only as sure as its least sure reader.
    const sweepConfidence =
      typeof finding.metadata?.confidence === 'number'
        ? finding.metadata.confidence
        : null;
    const confidence =
      verdict.confidence == null
        ? sweepConfidence
        : sweepConfidence == null
          ? verdict.confidence
          : Math.min(sweepConfidence, verdict.confidence);
    await this.findingRepository.update(finding.id, {
      metadata: {
        ...(finding.metadata ?? {}),
        findingVerdicts: [...prior, verdict],
        independentVerification: verdict.verdict,
        ...(verdict.verdict === 'confirmed' && confidence != null
          ? { confidence }
          : {}),
      } as Record<string, any>,
    });
    await this.bugHunterService.appendFindingEvent({
      findingId: finding.id,
      repo: finding.repo,
      stage: BugHuntEventStage.VERIFY,
      summary:
        verdict.verdict === 'confirmed'
          ? `Independent verifier confirmed this${verdict.fault ? ` and located the fault in ${verdict.fault.layer}${verdict.fault.repo ? ` (${verdict.fault.repo})` : ''}` : ''}${verdict.reproduction ? `: ${clip(verdict.reproduction)}` : ''}`
          : verdict.verdict === 'refuted'
            ? `Independent verifier refuted this${verdict.refutation ? `: ${clip(verdict.refutation)}` : ''}`
            : `Independent verifier was unsure${verdict.wouldBeWrongIf ? `: ${clip(verdict.wouldBeWrongIf)}` : ''}`,
      payload: { kind: 'finding', verdict },
    });

    await this.actOnVerdict(finding.id, verdict, confidence);
    return verdict;
  }

  private async actOnVerdict(
    findingId: string,
    verdict: BugFindingVerdict,
    confidence: number | null,
  ): Promise<void> {
    const finding = await this.bugFindingService.getOne(findingId);
    // A session in flight, a merged or released fix, a terminal decision: a
    // person (or a session) acted while the Verifier ran, and the verdict
    // is recorded but changes nothing. Every status locate-first dispatches
    // from — a fresh report, a failed or cancelled session, a closed PR —
    // is acted on, so a re-located report moves like a new one.
    if (!BUG_FINDING_LOCATE_STATUSES.includes(finding.status)) return;

    if (verdict.verdict === 'refuted') {
      await this.bugFindingService.setStatus(finding.id, {
        status: BugFindingStatus.DISMISSED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        decisionNote: (
          verdict.refutation ?? 'Refuted by the independent verifier.'
        ).slice(0, 500),
        confidence: verdict.confidence ?? undefined,
      });
      await this.bugHunterService.appendFindingEvent({
        findingId: finding.id,
        repo: finding.repo,
        stage: BugHuntEventStage.DECISION_RECORDED,
        summary: 'Dismissed by verification (independent verifier).',
        payload: {
          byVerification: true,
          decidedBy: null,
          runId: verdict.runId,
        },
      });
      return;
    }

    if (verdict.verdict === 'unsure') {
      if (finding.status === BugFindingStatus.NEW) {
        await this.bugFindingService.setStatus(finding.id, {
          status: BugFindingStatus.PENDING_APPROVAL,
        });
      }
      return;
    }

    // Confirmed with the fault outside the code: no fix session can repair a
    // row or a setting. D5 records the veto; the person gets the repair.
    if (isDataFault(verdict.fault)) {
      await this.notificationService.notify({
        level: BugHunterNotificationLevel.ACTION_NEEDED,
        ...faultIsNotCode(
          finding.title,
          verdict.fault!.layer,
          verdict.fault!.repair,
          verdict.fault!.evidence,
          repairableDataFault({ findingVerdicts: [verdict] })?.repo ?? null,
        ),
        findingId: finding.id,
        runId: verdict.runId ?? undefined,
        repo: finding.repo,
      });
    }

    // Confirmed. The orchestrator's D5 (OPP-0783) decides whether the fix
    // starts now or waits for a person; mode, confidence, budget and policy
    // veto inside it (a located data or config fault is a veto), and every
    // answer is a decision row.
    try {
      await this.orchestrator.onFindingConfirmed(finding.id, confidence);
    } catch (error) {
      this.logger.info(
        `[BUG_HUNTER] Confirmed finding ${finding.id} not fixed automatically: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

const clip = (s: string): string =>
  s.length > 160 ? `${s.slice(0, 157)}…` : s;
