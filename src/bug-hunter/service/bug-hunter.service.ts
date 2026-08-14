import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { LoggerService } from 'src/logger/logger.service';
import { NotificationService } from 'src/notification/service/notification.service';
import { computeCostUsd } from 'src/analytics/constants/llm-pricing.constants';

import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugHunterSettings } from '../entity/bug-hunter-settings.entity';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';
import { BugHuntEventRepository } from '../repository/bug-hunt-event.repository';
import { BugHunterSettingsRepository } from '../repository/bug-hunter-settings.repository';
import { BugHuntRunStatus, BugHuntTrigger } from '../enum/bug-hunt-run.enum';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';
import { BugHunterMode } from '../enum/bug-finding.enum';

/**
 * Owns the kill switch, the run lifecycle, and the event transcript.
 *
 * The workflow pipeline itself (`.claude/workflows/bug-hunt.mjs`) runs outside
 * this process — an external Claude Code agent, not an in-process job — so
 * every step it takes is reported back here over this module's HTTP surface
 * rather than by calling these methods directly in-process. This service is
 * the single place that decides what "a run" and "an event" mean; the
 * pipeline is just a caller.
 */
@Injectable()
export class BugHunterService {
  private readonly logger = LoggerService.getInstance(BugHunterService.name);

  constructor(
    private readonly settingsRepository: BugHunterSettingsRepository,
    private readonly runRepository: BugHuntRunRepository,
    private readonly eventRepository: BugHuntEventRepository,
    private readonly notificationService: NotificationService,
    private readonly dataSource: DataSource,
  ) {}

  // ── kill switch ──────────────────────────────────────────────────────────

  getSettings(): Promise<BugHunterSettings> {
    return this.settingsRepository.getSettings();
  }

  /**
   * Flips the switch and logs it as a timeline event with `runId = null`, so
   * the on/off history is visible in the same place as run activity — a
   * SUPER_DUPER_ADMIN reviewing "why did nothing run last night" sees the
   * mode change right next to the skipped run it explains.
   */
  async setMode(
    mode: BugHunterMode,
    updatedBy: number,
  ): Promise<BugHunterSettings> {
    const settings = await this.settingsRepository.setMode(mode, updatedBy);
    await this.eventRepository.save(
      this.eventRepository.create({
        runId: null,
        stage: BugHuntEventStage.SETTINGS_CHANGED,
        summary: `Bug Hunter mode set to ${mode.toUpperCase()} by user ${updatedBy}`,
        payload: { mode, updatedBy },
      }),
    );
    return settings;
  }

  /**
   * Both trigger paths call this FIRST. OFF means off for every trigger — no
   * "scheduled paused but manual still works" — so a run that finds the
   * switch off does zero further work: it records exactly one event and
   * exits without spending any tokens. MANUAL and AI both return the mode so
   * the pipeline knows, once Discover/Verify are done, whether a
   * verify-confirmed finding may go straight to the Fix stage (AI) or must
   * wait at PENDING_APPROVAL for an admin (MANUAL) — see bug-hunt.mjs.
   */
  async requireEnabledOrRecordSkip(
    trigger: BugHuntTrigger,
    repo: string,
  ): Promise<BugHunterMode | null> {
    const settings = await this.getSettings();
    if (settings.mode !== BugHunterMode.OFF) return settings.mode;

    const run = await this.runRepository.save(
      this.runRepository.create({
        trigger,
        repo,
        status: BugHuntRunStatus.SKIPPED_DISABLED,
        finishedAt: new Date(),
      }),
    );
    await this.eventRepository.save(
      this.eventRepository.create({
        runId: run.id,
        repo,
        stage: BugHuntEventStage.SKIPPED_DISABLED,
        summary: 'Bug Hunter is off — run skipped with zero token spend.',
      }),
    );
    return null;
  }

  // ── run lifecycle ────────────────────────────────────────────────────────

  async startRun(trigger: BugHuntTrigger, repo: string): Promise<BugHuntRun> {
    return this.runRepository.save(
      this.runRepository.create({ trigger, repo }),
    );
  }

  async getRun(id: string): Promise<BugHuntRun> {
    const run = await this.runRepository.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Bug hunt run ${id} not found`);
    return run;
  }

  listRuns(limit = 50): Promise<BugHuntRun[]> {
    return this.runRepository.listRecent(limit);
  }

  async getRunWithEvents(
    id: string,
  ): Promise<{ run: BugHuntRun; events: BugHuntEvent[] }> {
    const run = await this.getRun(id);
    const events = await this.eventRepository.listForRun(id);
    return { run, events };
  }

  listEventsSince(
    runId: string,
    afterCreatedAt: Date,
  ): Promise<BugHuntEvent[]> {
    return this.eventRepository.listSince(runId, afterCreatedAt);
  }

  /** Every event reported about one finding, across however many runs — the drawer's timeline. */
  listEventsForFinding(findingId: string): Promise<BugHuntEvent[]> {
    return this.eventRepository.listForFinding(findingId);
  }

  /**
   * Appends one transcript row. `runId` must belong to a RUNNING run — a
   * pipeline reporting into a run that already closed almost always means two
   * overlapping invocations for the same repo, which the rate-limit/lock the
   * pipeline itself holds should already prevent; this is the backstop.
   */
  async appendEvent(params: {
    runId: string;
    repo?: string;
    stage: BugHuntEventStage;
    summary: string;
    payload?: Record<string, any>;
    suggestionId?: string;
    findingId?: string;
  }): Promise<BugHuntEvent> {
    const run = await this.getRun(params.runId);
    if (run.status !== BugHuntRunStatus.RUNNING) {
      throw new ForbiddenException(
        `Run ${params.runId} is already ${run.status} — refusing to append further events.`,
      );
    }

    const event = await this.eventRepository.save(
      this.eventRepository.create({
        runId: params.runId,
        repo: params.repo ?? run.repo,
        stage: params.stage,
        summary: params.summary,
        payload: params.payload,
        suggestionId: params.suggestionId,
        findingId: params.findingId,
      }),
    );

    if (params.stage === BugHuntEventStage.ESCALATED) {
      await this.notificationService.notifyBugHunterEscalation({
        runId: run.id,
        repo: run.repo,
        summary: params.summary,
        payload: params.payload,
      });
    }

    return event;
  }

  /**
   * Closes a run: stamps totals, snapshots cost from `llm_usage`, and — for
   * anything other than a clean success with zero findings — posts a Slack
   * summary. A healthy, empty night stays quiet by design (see the plan's
   * "pull, not push" note); FAILED and any run with escalations always post.
   */
  async closeRun(
    id: string,
    status: BugHuntRunStatus.COMPLETED | BugHuntRunStatus.FAILED,
    totals: {
      foundCount: number;
      autoMergedCount: number;
      prOpenedCount: number;
      dismissedCount: number;
    },
    errorMessage?: string,
  ): Promise<BugHuntRun> {
    const run = await this.getRun(id);
    const totalTokenCostUsd = await this.snapshotCostUsd(id);

    await this.runRepository.update(id, {
      status,
      finishedAt: new Date(),
      ...totals,
      totalTokenCostUsd: totalTokenCostUsd.toFixed(4),
      ...(errorMessage
        ? { metadata: { ...run.metadata, errorMessage } as Record<string, any> }
        : {}),
    });
    const closed = await this.getRun(id);

    const escalated = (await this.eventRepository.listForRun(id)).some(
      (e) => e.stage === BugHuntEventStage.ESCALATED,
    );
    const noteworthy =
      status === BugHuntRunStatus.FAILED || escalated || totals.foundCount > 0;
    if (noteworthy) {
      await this.notificationService.notifyBugHunterRunSummary({
        runId: closed.id,
        repo: closed.repo,
        status: closed.status,
        ...totals,
        totalTokenCostUsd: closed.totalTokenCostUsd,
      });
    }

    return closed;
  }

  /**
   * Sums estimated USD cost from `llm_usage` rows tagged for this run
   * (`metadata->>'runId'`), grouped by model so each model's own rate applies
   * — mirrors PlatformAnalyticsRepository's by-name query-builder pattern
   * over `llm_usage` rather than pulling in the whole LlmUsageRepository for
   * one grouped sum.
   */
  private async snapshotCostUsd(runId: string): Promise<number> {
    try {
      const rows: {
        model: string;
        promptTokens: string;
        completionTokens: string;
      }[] = await this.dataSource
        .createQueryBuilder()
        .select('lu.model', 'model')
        .addSelect('COALESCE(SUM(lu."promptTokens"), 0)', 'promptTokens')
        .addSelect(
          'COALESCE(SUM(lu."completionTokens"), 0)',
          'completionTokens',
        )
        .from('llm_usage', 'lu')
        .where(`lu.metadata ->> 'runId' = :runId`, { runId })
        .groupBy('lu.model')
        .getRawMany();

      return rows.reduce((sum, row) => {
        const { costUsd } = computeCostUsd(
          row.model,
          Number(row.promptTokens),
          Number(row.completionTokens),
        );
        return sum + costUsd;
      }, 0);
    } catch (error) {
      // Best-effort, same contract as LlmUsageService.record: cost visibility
      // must never fail a run close.
      this.logger.warn(
        `Failed to snapshot bug-hunt cost for run ${runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 0;
    }
  }
}
