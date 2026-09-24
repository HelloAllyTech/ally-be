import { Injectable } from '@nestjs/common';

import { LoggerService } from 'src/logger/logger.service';

import { BugHuntRun } from '../entity/bug-hunt-run.entity';
import { BugHuntPhaseTiming } from '../entity/bug-hunt-phase.entity';
import { BugHuntContextLookup } from '../entity/bug-hunt-context-lookup.entity';
import {
  BugHuntLookupKind,
  BugHuntPhaseEvent,
} from '../enum/bug-hunt-telemetry.enum';
import { BugHuntRunRepository } from '../repository/bug-hunt-run.repository';
import {
  BugHuntContextLookupRepository,
  BugHuntPhaseRepository,
} from '../repository/bug-hunt-telemetry.repository';
import {
  BugHuntBreadthDto,
  BugHunterPipelineMetricsDto,
  BugHuntRunTelemetryDto,
  RecordBugHuntContextDto,
  RecordBugHuntLookupDto,
  RecordBugHuntPhaseDto,
} from '../dto/bug-hunter-telemetry.dto';
import { BugHunterService } from './bug-hunter.service';

/** Key under `bug_hunt_runs.metadata` holding the agent-reported code-scope summary. */
export const BUG_HUNT_BREADTH_METADATA_KEY = 'breadth';

/**
 * Stage-level telemetry for Bug Hunter runs: how long each phase took, what
 * context the agent was handed and how long it waited for it, and how much of
 * the repo it was shown.
 *
 * ## Why a separate service
 *
 * `BugHunterService` owns the run's lifecycle and its transcript; the metrics
 * service owns finding outcomes. Neither answered "which part of last night
 * was slow, and what did the agent actually see". This does, and it is kept
 * apart so that every write here can be best-effort: telemetry must never be
 * the reason a sweep fails, so `recordLookup` swallows its own errors and
 * `timed` returns the wrapped result whether or not the row landed.
 *
 * ## Two ways rows arrive
 *
 * Phases and code-scope breadth come from the agent, which is the only party
 * that knows when it moved on or how big the diff was. Lookups against the
 * pipeline's own endpoints are recorded here by the server as they are
 * served, via `timed`, so an agent that passes `&runId=` is measured with no
 * further cooperation — and cannot forget to report them.
 */
@Injectable()
export class BugHunterTelemetryService {
  private readonly logger = LoggerService.getInstance(
    BugHunterTelemetryService.name,
  );

  constructor(
    private readonly bugHunterService: BugHunterService,
    private readonly runRepository: BugHuntRunRepository,
    private readonly phaseRepository: BugHuntPhaseRepository,
    private readonly lookupRepository: BugHuntContextLookupRepository,
  ) {}

  /**
   * Mark a phase boundary. One row per (run, phase): a second `started` keeps
   * the first start and counts the repeat, because the fix protocol re-enters
   * FIX on a retry and the honest duration is first entry to last exit. A
   * `finished` with no prior start opens and closes the row at once, so a
   * boundary the agent forgot still leaves a record rather than a 404.
   */
  async recordPhase(
    runId: string,
    dto: RecordBugHuntPhaseDto,
    at: Date = new Date(),
  ): Promise<BugHuntPhaseTiming> {
    await this.bugHunterService.getRun(runId);

    const existing = await this.phaseRepository.findOne({
      where: { runId, phase: dto.phase },
    });

    if (dto.event === BugHuntPhaseEvent.STARTED) {
      if (!existing) {
        return this.phaseRepository.save(
          this.phaseRepository.create({
            runId,
            phase: dto.phase,
            startedAt: at,
            metadata: { startedCount: 1, ...(dto.metadata ?? {}) },
          }),
        );
      }
      existing.metadata = {
        ...(existing.metadata ?? {}),
        ...(dto.metadata ?? {}),
        startedCount: Number(existing.metadata?.startedCount ?? 1) + 1,
      };
      // A phase re-entered after it was closed (a second fix attempt) is open
      // again: the duration is re-stamped on the next finish.
      existing.finishedAt = null;
      existing.durationMs = null;
      return this.phaseRepository.save(existing);
    }

    const row =
      existing ??
      this.phaseRepository.create({
        runId,
        phase: dto.phase,
        startedAt: at,
        metadata: { startedCount: 0 },
      });
    row.finishedAt = at;
    row.durationMs = Math.max(0, at.getTime() - row.startedAt.getTime());
    if (dto.summary) row.summary = dto.summary;
    if (dto.metadata)
      row.metadata = { ...(row.metadata ?? {}), ...dto.metadata };
    return this.phaseRepository.save(row);
  }

  /**
   * Record one context lookup. Best-effort by design: a telemetry write must
   * never fail the request that produced the data, so this logs and returns
   * null instead of throwing.
   */
  async recordLookup(
    runId: string,
    params: {
      kind: BugHuntLookupKind;
      itemCount: number;
      chars?: number;
      latencyMs?: number;
      relevance?: number | null;
      usedCount?: number | null;
      metadata?: Record<string, any> | null;
    },
  ): Promise<BugHuntContextLookup | null> {
    try {
      return await this.lookupRepository.save(
        this.lookupRepository.create({
          runId,
          kind: params.kind,
          itemCount: params.itemCount,
          chars: params.chars ?? 0,
          latencyMs: params.latencyMs ?? 0,
          relevance:
            params.relevance === null || params.relevance === undefined
              ? null
              : params.relevance.toFixed(4),
          usedCount: params.usedCount ?? null,
          metadata: params.metadata ?? null,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Bug Hunter telemetry: could not record ${params.kind} lookup for run ${runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** The agent-side form of `recordLookup`, from `POST runs/:id/lookups`. */
  async recordReportedLookup(
    runId: string,
    dto: RecordBugHuntLookupDto,
  ): Promise<void> {
    await this.bugHunterService.getRun(runId);
    await this.recordLookup(runId, dto);
  }

  /**
   * Serve a pipeline lookup and, when the caller named its run, record what
   * it got and how long it waited. `measure` turns the result into a size and
   * a count; a null result (a repo with no log group) is recorded as zero
   * items, which is the correct reading of "asked, nothing there".
   */
  async timed<T>(
    runId: string | undefined,
    kind: BugHuntLookupKind,
    fetch: () => Promise<T>,
    measure: (result: T) => { itemCount: number; chars: number },
    metadata?: Record<string, any>,
  ): Promise<T> {
    const startedAt = Date.now();
    const result = await fetch();
    if (runId) {
      const { itemCount, chars } = measure(result);
      await this.recordLookup(runId, {
        kind,
        itemCount,
        chars,
        latencyMs: Date.now() - startedAt,
        metadata,
      });
    }
    return result;
  }

  /**
   * Store the agent's code-scope summary on the run. Merged into
   * `metadata.breadth` rather than a new column set: it is one small object,
   * written once per run, and the run's metadata already carries this kind of
   * per-run fact (`errorMessage`, `cliReportedCostUsd`).
   */
  async recordContext(
    runId: string,
    dto: RecordBugHuntContextDto,
  ): Promise<BugHuntRun> {
    const run = await this.bugHunterService.getRun(runId);
    const previous =
      (run.metadata?.[BUG_HUNT_BREADTH_METADATA_KEY] as Record<string, any>) ??
      {};
    await this.runRepository.update(runId, {
      metadata: {
        ...(run.metadata ?? {}),
        [BUG_HUNT_BREADTH_METADATA_KEY]: { ...previous, ...dto },
      } as Record<string, any>,
    });
    return this.bugHunterService.getRun(runId);
  }

  async getRunTelemetry(runId: string): Promise<BugHuntRunTelemetryDto> {
    const run = await this.bugHunterService.getRun(runId);
    const [phases, lookups] = await Promise.all([
      this.phaseRepository.listForRun(runId),
      this.lookupRepository.listForRun(runId),
    ]);
    const reported =
      (run.metadata?.[BUG_HUNT_BREADTH_METADATA_KEY] as Record<string, any>) ??
      {};
    const breadth: BugHuntBreadthDto = {
      deep: typeof reported.deep === 'boolean' ? reported.deep : null,
      commits: reported.commits ?? null,
      filesInScope: reported.filesInScope ?? null,
      linesInScope: reported.linesInScope ?? null,
      packChars: reported.packChars ?? null,
      lookupItems: lookups.reduce((sum, l) => sum + l.itemCount, 0),
      lookupChars: lookups.reduce((sum, l) => sum + l.chars, 0),
    };
    const finished = run.finishedAt ?? null;
    return {
      runId,
      phases: phases.map((p) => ({
        phase: p.phase,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt ?? null,
        durationMs: p.durationMs ?? null,
        summary: p.summary ?? null,
        metadata: p.metadata ?? null,
      })),
      lookups: lookups.map((l) => ({
        kind: l.kind,
        itemCount: l.itemCount,
        chars: l.chars,
        latencyMs: l.latencyMs,
        relevance:
          l.relevance === null || l.relevance === undefined
            ? null
            : Number(l.relevance),
        usedCount: l.usedCount ?? null,
        at: l.createdAt,
      })),
      breadth,
      totalInputTokens: run.totalInputTokens ?? null,
      totalOutputTokens: run.totalOutputTokens ?? null,
      totalDurationMs: finished
        ? finished.getTime() - run.createdAt.getTime()
        : null,
    };
  }

  /** The aggregate view behind the team's pipeline panel. */
  async pipelineMetrics(
    windowDays: number,
  ): Promise<BugHunterPipelineMetricsDto> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const [phases, lookups, breadth] = await Promise.all([
      this.phaseRepository.durationStats(since),
      this.lookupRepository.kindStats(since),
      this.runRepository.breadthStats(since),
    ]);
    return {
      windowDays,
      phases,
      lookups,
      breadth,
      computedAt: new Date().toISOString(),
    };
  }
}
