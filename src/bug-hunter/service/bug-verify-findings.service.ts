import { Injectable } from '@nestjs/common';

import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import {
  BUG_FIX_SESSION_DEFAULT_REF,
  BUG_FIX_SESSION_WORKFLOW_FILE,
} from '../constants/bug-fix-session.constants';
import { repoCommands } from '../constants/bug-hunt-repos.constants';
import { BUG_HUNT_LOW_CONFIDENCE_THRESHOLD } from '../constants/bug-hunter.constants';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import {
  BugFindingVerdict,
  toBugFindingVerdict,
} from '../type/bug-finding-verdict.type';
import { BugHunterEngine } from '../type/bug-hunter-model-settings.type';
import { BugFindingService } from './bug-finding.service';
import { BugFixSessionService } from './bug-fix-session.service';
import { BugHunterModelSettingsService } from './bug-hunter-model-settings.service';
import { BugHunterPolicyService } from './bug-hunter-policy.service';
import { BugHunterService } from './bug-hunter.service';
import { counterpartFor } from './bug-verify-fix.service';

/** Stored on the verify run's metadata, so the workflow's models call can read the counterpart. */
export interface VerifyFindingsDispatch {
  sweepRunId: string;
  findingIds: string[];
  sweepEngine: string | null;
  sweepModel: string | null;
  counterpart: { engine: BugHunterEngine; model: string };
  dispatchedAt: string;
}

/**
 * The Verifier stage for findings — OPP-0780. See `BugFindingVerdict`.
 *
 *  1. `dispatchForRun` — a sweep closed. Every unproven finding it kept goes
 *     to one `verify_findings` run on the other vendor, marked `pending`.
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
  ) {}

  /** Best-effort: a verifier that cannot be dispatched leaves the findings pending, which is the safe side. */
  async dispatchForRun(
    sweepRunId: string,
  ): Promise<VerifyFindingsDispatch | null> {
    try {
      const sweep = await this.bugHunterService.getRun(sweepRunId);
      if (
        sweep.trigger !== BugHuntTrigger.SCHEDULED &&
        sweep.trigger !== BugHuntTrigger.MANUAL
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
      const counterpart = counterpartFor(
        sweep.engine ?? null,
        sweep.model ?? null,
        settings,
      );
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
          ? `Independent verifier confirmed this${verdict.reproduction ? `: ${clip(verdict.reproduction)}` : ''}`
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
    if (
      finding.status !== BugFindingStatus.NEW &&
      finding.status !== BugFindingStatus.PENDING_APPROVAL
    ) {
      return; // a person already acted on it
    }

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

    // Confirmed. In AI mode and above the bar, the fix session the sweep
    // would once have started itself. Otherwise it sits in the queue as a
    // verified finding, which is what the queue is now for.
    const settings = await this.bugHunterService.getSettings();
    if (settings.mode !== BugHunterMode.AI) return;
    if (confidence != null && confidence < BUG_HUNT_LOW_CONFIDENCE_THRESHOLD) {
      await this.bugFindingService.setStatus(finding.id, {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
      return;
    }
    try {
      const fresh = await this.bugFindingService.getOne(finding.id);
      await this.policyService.assertMayFix(fresh);
      await this.fixSessionService.startByAgent(fresh.id, 'verifier');
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
