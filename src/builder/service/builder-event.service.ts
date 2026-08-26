import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderBuildEvent } from '../entity/builder-build-event.entity';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderSessionRepository } from '../repository/builder-session.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
} from '../repository/builder-build.repository';
import {
  BuilderEventType,
  BuilderRunStatus,
  BuilderStage,
} from '../enum/builder.enum';
import { BUILDER_EVENT_PAYLOAD_MAX_BYTES } from '../constants/builder.constants';

/** A listener the gateway registers to push events to connected clients. */
export type BuilderEventListener = (
  sessionId: string,
  events: BuilderBuildEvent[],
) => void;

const VALID_STAGES = new Set<string>(Object.values(BuilderStage));
const VALID_TYPES = new Set<string>(Object.values(BuilderEventType));

/**
 * Ingestion for the build log, and the seam the gateway pushes from.
 *
 * The listener indirection exists so this service knows nothing about
 * sockets: it is called from an HTTP controller on the pipeline path, and a
 * hard dependency on a gateway would make every ingestion test drag a
 * WebSocket server behind it.
 */
@Injectable()
export class BuilderEventService {
  private readonly logger = LoggerService.getInstance(BuilderEventService.name);
  private listener: BuilderEventListener | null = null;

  constructor(
    private readonly eventRepository: BuilderBuildEventRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly sessionRepository: BuilderSessionRepository,
  ) {}

  addListener(listener: BuilderEventListener): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = null;
  }

  /**
   * Persist a batch from the runner and push it to anyone watching.
   *
   * Unknown types and stages are coerced rather than rejected: a batch is
   * telemetry from a long-running job, and dropping the whole POST because
   * one event carried a typo'd type would lose the nineteen good ones with it.
   */
  async ingest(
    run: BuilderBuildRun,
    incoming: {
      type?: string;
      stage?: string;
      payload?: Record<string, any>;
    }[],
  ): Promise<BuilderBuildEvent[]> {
    const prepared = incoming
      .map((event) => {
        const type = String(event.type ?? '');
        if (!VALID_TYPES.has(type)) {
          this.logger.warn(
            `Builder run ${run.id} sent unknown event type "${type}" — recording as text.`,
          );
        }
        const stage =
          event.stage && VALID_STAGES.has(event.stage) ? event.stage : null;
        return {
          sessionId: run.sessionId,
          stage,
          type: VALID_TYPES.has(type) ? type : BuilderEventType.TEXT,
          payload: this.truncatePayload(event.payload ?? {}),
        };
      })
      .filter(Boolean);

    if (!prepared.length) return [];

    const saved = await this.eventRepository.appendBatch(run.id, prepared);

    // A stage_change is the one event that also moves durable state — it is
    // what the session list reads to say what the build is doing right now.
    const latestStage = [...prepared]
      .reverse()
      .find((event) => event.type === BuilderEventType.STAGE_CHANGE);
    if (latestStage) {
      const stage = String(latestStage.payload?.stage ?? '');
      if (VALID_STAGES.has(stage)) {
        await this.sessionRepository.update(
          { id: run.sessionId },
          { currentStage: stage as BuilderStage },
        );
      }
    }

    // First event of any kind means the runner is alive and working.
    if (run.status === BuilderRunStatus.QUEUED) {
      await this.runRepository.update(
        { id: run.id },
        {
          status: BuilderRunStatus.RUNNING,
          startedAt: run.startedAt ?? new Date(),
        },
      );
    }

    this.push(run.sessionId, saved);
    return saved;
  }

  /** Record one event without a runner — used for server-side annotations. */
  async record(
    run: BuilderBuildRun,
    type: BuilderEventType,
    payload: Record<string, any>,
    stage?: BuilderStage | null,
  ): Promise<void> {
    const saved = await this.eventRepository.appendBatch(run.id, [
      {
        sessionId: run.sessionId,
        stage: stage ?? null,
        type,
        payload: this.truncatePayload(payload),
      },
    ]);
    this.push(run.sessionId, saved);
  }

  private push(sessionId: string, events: BuilderBuildEvent[]): void {
    if (!this.listener || !events.length) return;
    try {
      this.listener(sessionId, events);
    } catch (error) {
      // A broken socket must not fail the ingestion that fed it; the polling
      // fallback will pick these up regardless.
      this.logger.warn(
        `Builder event push failed for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Cap a payload's size. stream-json carries whole file contents and whole
   * test logs; stored unbounded, one run can put megabytes into the row that
   * the feed then has to ship on every page.
   *
   * Truncation is marked, not silent — a reader who sees a cut-off diff should
   * know it was cut off rather than think the change was that small.
   */
  private truncatePayload(payload: Record<string, any>): Record<string, any> {
    const serialized = JSON.stringify(payload ?? {});
    if (serialized.length <= BUILDER_EVENT_PAYLOAD_MAX_BYTES) {
      return payload;
    }

    const result: Record<string, any> = {};
    let budget = BUILDER_EVENT_PAYLOAD_MAX_BYTES;
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string' && value.length > budget) {
        result[key] = `${value.slice(0, Math.max(0, budget))}\n…[truncated]`;
        budget = 0;
        continue;
      }
      const size = JSON.stringify(value ?? null).length;
      if (size > budget) {
        result[key] = '…[truncated]';
        budget = 0;
        continue;
      }
      result[key] = value;
      budget -= size;
    }
    result.truncated = true;
    return result;
  }

  listByRun(runId: string, afterSeq: number, limit: number) {
    return this.eventRepository.listByRun(runId, afterSeq, limit);
  }
}
