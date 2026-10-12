import { Injectable } from '@nestjs/common';

import { GithubActionsService } from 'src/github/service/github-actions.service';
import { LoggerService } from 'src/logger/logger.service';

import { BUG_HUNT_REPOS } from '../constants/bug-hunt-repos.constants';
import {
  BUG_FINDER_EVENT_DEBOUNCE_MS,
  BUG_FINDER_REPORT_LOOKBACK_MS,
  BUG_FINDER_TRIAGE_DROP_MIN_CONFIDENCE,
} from '../constants/bug-hunter.constants';
import { BugFinding } from '../entity/bug-finding.entity';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import {
  BugFindingDecisionReason,
  BugFindingSource,
  BugFindingStatus,
  BugHunterMode,
} from '../enum/bug-finding.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugFindingRepository } from '../repository/bug-finding.repository';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';
import {
  BUG_HUNTER_FINDER_MODEL_MENU,
  BUG_HUNTER_SENSES,
  BUG_HUNTER_SENSE_DESCRIPTIONS,
  BUG_HUNTER_TRIAGE_MENU,
  BugHunterSense,
  BugHunterTriage,
  FinderPlan,
  FinderTriggerKind,
  senseOfSource,
  sensesForRepo,
} from '../type/bug-hunter-finder.type';
import { BugHunterEngine } from '../type/bug-hunter-model-settings.type';
import { BugFindingService } from './bug-finding.service';
import { BugHuntSweepService } from './bug-hunt-sweep.service';
import { BugHunterDecisionService } from './bug-hunter-decision.service';
import { BugHunterFinderDataService } from './bug-hunter-finder-data.service';
import { BugHunterModelSettingsService } from './bug-hunter-model-settings.service';
import { BugHunterScoreboardService } from './bug-hunter-scoreboard.service';
import { BugHunterService } from './bug-hunter.service';

/**
 * The senses a light pass starts from, per trigger, when the rule decides.
 * Narrowed to the repo's menu before use. `locale_parity` rides along on a
 * merge because it costs no model time and a merge is exactly when a locale
 * file goes out of step.
 */
const RULE_SENSES: Record<FinderTriggerKind, BugHunterSense[]> = {
  scheduled: [...BUG_HUNTER_SENSES],
  manual: [...BUG_HUNTER_SENSES],
  merge: ['code_review', 'tests', 'locale_parity'],
  report: ['reported_bugs', 'code_review'],
};

/**
 * The Finder stage — OPP-0781. See `bug-hunter-finder.type.ts` for the three
 * decisions. This service makes them (through the decision service, which
 * records them), acts on D3, and runs the event triggers that start light
 * passes between the nightly sweeps.
 */
@Injectable()
export class BugHunterFinderService {
  private readonly logger = LoggerService.getInstance(
    BugHunterFinderService.name,
  );

  constructor(
    private readonly decisions: BugHunterDecisionService,
    private readonly scoreboard: BugHunterScoreboardService,
    private readonly bugHunterService: BugHunterService,
    private readonly bugFindingService: BugFindingService,
    private readonly findingRepository: BugFindingRepository,
    private readonly runRepository: BugHuntRunRepository,
    private readonly modelSettingsService: BugHunterModelSettingsService,
    private readonly finderData: BugHunterFinderDataService,
    private readonly github: GithubActionsService,
    private readonly sweepService: BugHuntSweepService,
  ) {}

  /**
   * D1 and D2 for a run, made once and stored on the run. Called the first
   * time the workflow fetches the sweep prompt, which is before it asks for
   * its model — so both decisions are in place when they are needed.
   */
  async ensurePlan(run: BugHuntRun): Promise<FinderPlan> {
    const existing = run.metadata?.finder as FinderPlan | undefined;
    if (existing?.senses?.length && existing.model) return existing;

    const trigger: FinderTriggerKind =
      (run.metadata?.finderTrigger as FinderTriggerKind | undefined) ??
      (run.trigger === BugHuntTrigger.SCHEDULED ? 'scheduled' : 'manual');
    const light = run.metadata?.finderLight === true;
    const board = await this.scoreboard.forRepo(run.repo).catch(() => null);
    const open = await this.openBySource(run.repo);
    const settings = await this.modelSettingsService.get();
    const lastCompleted = await this.runRepository
      .findLastCompleted(run.repo)
      .catch(() => null);
    const menu = sensesForRepo(run.repo);
    const context = {
      trigger,
      light,
      repo: run.repo,
      hasLocaleFiles: menu.includes('locale_parity'),
      hasLogGroup: this.finderData.hasLogGroup(run.repo),
      hasExternalSignal: this.finderData.hasExternalSignal(run.repo),
      hoursSinceLastSweep: lastCompleted
        ? Math.round(
            (Date.now() -
              (lastCompleted.finishedAt ?? lastCompleted.createdAt).getTime()) /
              36e5,
          )
        : null,
      openFindingsBySource: open,
      scoreboardBySense: board?.bySense ?? {},
      scoreboardByModel: board?.byModel ?? {},
      senseDescriptions: BUG_HUNTER_SENSE_DESCRIPTIONS,
    };

    const d1 = await this.decisions.decide<BugHunterSense[]>({
      point: 'D1',
      question: 'senses',
      repo: run.repo,
      runId: run.id,
      menu,
      context,
      modelOwned: true,
      rule: () => RULE_SENSES[trigger].filter((s) => menu.includes(s)),
      validate: (raw) => {
        if (!Array.isArray(raw)) return null;
        const picked = raw.filter((s): s is BugHunterSense =>
          menu.includes(s as never),
        );
        return picked.length ? [...new Set(picked)] : null;
      },
    });

    const defaultEntry =
      BUG_HUNTER_FINDER_MODEL_MENU.find(
        (m) =>
          m.engine === settings.engine && m.model === settings.defaultModel,
      ) ??
      BUG_HUNTER_FINDER_MODEL_MENU.find((m) => m.engine === settings.engine) ??
      BUG_HUNTER_FINDER_MODEL_MENU[1];
    const d2 = await this.decisions.decide<{
      engine: BugHunterEngine;
      model: string;
    }>({
      point: 'D2',
      question: 'model',
      repo: run.repo,
      runId: run.id,
      menu: BUG_HUNTER_FINDER_MODEL_MENU,
      context: { ...context, senses: d1.pick, platformDefault: defaultEntry },
      modelOwned: true,
      rule: () => ({ engine: defaultEntry.engine, model: defaultEntry.model }),
      validate: (raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const { engine, model } = raw as Record<string, unknown>;
        const hit = BUG_HUNTER_FINDER_MODEL_MENU.find(
          (m) => m.engine === engine && m.model === model,
        );
        return hit ? { engine: hit.engine, model: hit.model } : null;
      },
    });

    const plan: FinderPlan = {
      trigger,
      light,
      senses: d1.pick,
      model: d2.pick,
      decisions: { D1: d1.record.id, D2: d2.record.id },
      plannedAt: new Date().toISOString(),
    };
    await this.bugHunterService.setRunMetadata(run.id, { finder: plan });
    await this.bugHunterService.appendEvent({
      runId: run.id,
      repo: run.repo,
      stage: BugHuntEventStage.FINDER_RESULT,
      summary:
        `Finder plan (${trigger}${light ? ', light' : ''}): senses ${plan.senses.join(', ')} ` +
        `on ${plan.model.engine} (${plan.model.model}). D1 by ${d1.owner}${
          d1.shadowPick ? ` (shadow: ${d1.shadowPick.join(', ')})` : ''
        }; D2 by ${d2.owner}${d2.shadowPick ? ` (shadow: ${d2.shadowPick.model})` : ''}.`,
      payload: { plan, reasons: { D1: d1.reason, D2: d2.reason } },
    });
    return plan;
  }

  /**
   * D3 for each new unproven finding a sweep just persisted. Best-effort and
   * not awaited by the persisting call; a triage that fails leaves the
   * finding at NEW, which is the rule's pick anyway.
   */
  async triageNew(findings: BugFinding[], runId: string): Promise<void> {
    const candidates = findings.filter(
      (f) =>
        f.status === BugFindingStatus.NEW &&
        !f.proven &&
        f.source !== BugFindingSource.REPORTED_BUG &&
        !f.metadata?.triage,
    );
    if (!candidates.length) return;
    const repo = candidates[0].repo ?? null;
    const [board, knownNonBugs] = await Promise.all([
      repo ? this.scoreboard.forRepo(repo).catch(() => null) : null,
      repo ? this.bugFindingService.listKnownNonBugs(repo).catch(() => []) : [],
    ]);

    for (const f of candidates) {
      try {
        const sense = senseOfSource(f.source);
        const d3 = await this.decisions.decide<BugHunterTriage>({
          point: 'D3',
          question: 'triage',
          repo,
          runId,
          findingId: f.id,
          menu: [...BUG_HUNTER_TRIAGE_MENU],
          context: {
            finding: {
              title: f.title,
              description: f.description,
              source: f.source,
              sense,
              file: f.file,
              symbol: f.symbol,
              evidence: f.evidence,
              severity: f.severity,
              touchesGuardedPath: f.touchesGuardedPath,
              sweepConfidence: f.metadata?.confidence ?? null,
            },
            senseScore: sense ? (board?.bySense[sense] ?? null) : null,
            knownNonBugs: (knownNonBugs ?? []).slice(0, 12),
          },
          modelOwned: true,
          rule: () => 'verify',
          validate: (raw) =>
            BUG_HUNTER_TRIAGE_MENU.includes(raw as never)
              ? (raw as BugHunterTriage)
              : null,
        });
        await this.actOnTriage(
          f,
          d3.pick,
          d3.owner,
          d3.reason,
          d3.confidence,
          d3.record.id,
        );
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] D3 triage failed for finding ${f.id}; it stays at NEW: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async actOnTriage(
    f: BugFinding,
    pick: BugHunterTriage,
    owner: 'model' | 'rule',
    reason: string,
    confidence: number | null,
    decisionId: string,
  ): Promise<void> {
    // A drop is the one pick that costs a bug if wrong, so a model has to be
    // sure of it; otherwise it is treated as "verify" and the row says so.
    let acted: BugHunterTriage = pick;
    if (
      pick === 'drop' &&
      owner === 'model' &&
      (confidence == null || confidence < BUG_FINDER_TRIAGE_DROP_MIN_CONFIDENCE)
    ) {
      acted = 'verify';
    }
    await this.findingRepository.update(f.id, {
      metadata: {
        ...(f.metadata ?? {}),
        triage: {
          pick,
          acted,
          owner,
          decisionId,
          at: new Date().toISOString(),
        },
      } as Record<string, any>,
    });
    if (acted === 'hold') {
      await this.bugFindingService.setStatus(f.id, {
        status: BugFindingStatus.PENDING_APPROVAL,
      });
      await this.bugHunterService.appendFindingEvent({
        findingId: f.id,
        repo: f.repo,
        stage: BugHuntEventStage.FINDER_RESULT,
        summary: `Finder triage held this for a person${reason ? `: ${reason}` : ''}.`,
        payload: { decision: 'D3', pick, owner, decisionId },
      });
    } else if (acted === 'drop') {
      await this.bugFindingService.setStatus(f.id, {
        status: BugFindingStatus.DISMISSED,
        decisionReason: BugFindingDecisionReason.NOT_A_BUG,
        decisionNote: (
          reason || 'Dropped by the Finder’s triage as noise.'
        ).slice(0, 500),
      });
      await this.bugHunterService.appendFindingEvent({
        findingId: f.id,
        repo: f.repo,
        stage: BugHuntEventStage.DECISION_RECORDED,
        summary: `Dropped by the Finder’s triage${reason ? `: ${reason}` : ''}.`,
        payload: {
          decision: 'D3',
          pick,
          owner,
          decisionId,
          byVerification: false,
        },
      });
    }
    // 'verify' needs no action: the independent verifier picks it up at close.
  }

  /**
   * The event triggers (OPP-0781): a light pass after a merge or a human
   * report, debounced per repo. Runs on the scheduler every few minutes.
   */
  async runEventTriggers(): Promise<void> {
    const settings = await this.bugHunterService.getSettings();
    if (settings.mode === BugHunterMode.OFF) return;
    const running = new Set(
      (await this.runRepository.listRunning()).map((r) => r.repo),
    );
    for (const [repo, config] of Object.entries(BUG_HUNT_REPOS)) {
      if (!config.fixable || running.has(repo)) continue;
      try {
        const last = await this.runRepository.findLastCompleted(repo);
        const lastAt = last ? (last.finishedAt ?? last.createdAt) : null;
        if (
          lastAt &&
          Date.now() - lastAt.getTime() < BUG_FINDER_EVENT_DEBOUNCE_MS
        )
          continue;

        const since = new Date(
          Math.max(
            lastAt?.getTime() ?? 0,
            Date.now() - BUG_FINDER_REPORT_LOOKBACK_MS,
          ),
        );
        const reports = (
          await this.findingRepository.find({
            where: { repo, source: BugFindingSource.REPORTED_BUG },
            order: { createdAt: 'DESC' },
            take: 10,
          })
        ).filter((f) => f.createdAt >= since && !f.metadata?.finderTriggered);
        let kind: FinderTriggerKind | null = null;
        if (reports.length) kind = 'report';
        else if (lastAt && (await this.github.hasCommitsSince(repo, lastAt)))
          kind = 'merge';
        if (!kind) continue;

        const run = await this.sweepService.trigger(repo, null, false, {
          kind,
          light: true,
        });
        if (!run) continue;
        for (const r of reports) {
          await this.findingRepository.update(r.id, {
            metadata: {
              ...(r.metadata ?? {}),
              finderTriggered: run.id,
            } as Record<string, any>,
          });
        }
        this.logger.info(
          `[BUG_HUNTER] Finder: light pass on ${repo} after a ${kind} (run ${run.id}).`,
        );
      } catch (error) {
        this.logger.warn(
          `[BUG_HUNTER] Finder event trigger failed for ${repo}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async openBySource(repo: string): Promise<Record<string, number>> {
    const rows = await this.findingRepository.find({
      where: [
        { repo, status: BugFindingStatus.NEW },
        { repo, status: BugFindingStatus.PENDING_APPROVAL },
      ],
      select: ['id', 'source'],
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.source] = (out[r.source] ?? 0) + 1;
    return out;
  }
}
