import { Injectable } from '@nestjs/common';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { CopilotRun } from '../entity/copilot-run.entity';
import { CopilotRunStatus } from '../enum/copilot-run.enum';
import {
  COPILOT_END_STATUSES,
  COPILOT_PROGRESS_LABEL_MAX,
  COPILOT_PROGRESS_LOG_MAX,
  COPILOT_PROGRESS_REASON_MAX,
} from '../constants/copilot.constant';
import {
  CopilotProgressEvent,
  CopilotProgressEventKind,
} from '../type/copilot-run.type';
import { TIME } from 'src/common/constants/time.constants';

/** Progress events that must never be dropped when the log is capped. */
const PROGRESS_ANCHOR_KINDS: ReadonlySet<CopilotProgressEventKind> = new Set([
  'round_scored',
  'revise_requested',
  'succeeded',
  'failed',
  'cancelled',
]);

/** Drop oldest non-anchor events until the log fits within the hard cap. */
function capProgressLog(
  events: CopilotProgressEvent[],
): CopilotProgressEvent[] {
  if (events.length <= COPILOT_PROGRESS_LOG_MAX) return events;
  const result = [...events];
  while (result.length > COPILOT_PROGRESS_LOG_MAX) {
    const idx = result.findIndex((e) => !PROGRESS_ANCHOR_KINDS.has(e.kind));
    if (idx === -1) break; // all remaining are anchors — keep them
    result.splice(idx, 1);
  }
  return result;
}

@Injectable()
export class CopilotRunRepository extends Repository<CopilotRun> {
  constructor(private readonly dataSource: DataSource) {
    super(CopilotRun, dataSource.createEntityManager());
  }

  /** Find the active run whose current round is being evaluated by this report. */
  async findActiveByReportId(reportId: string): Promise<CopilotRun | null> {
    return this.findOne({ where: { currentReportId: reportId } });
  }

  /**
   * Atomically append one event to a run's activity feed. Assigns a monotonic
   * `seq` from the run's `progressSeq` counter, truncates label/reason, and
   * enforces the length cap. Uses a row lock so the webhook-driven resume
   * append and the round it resumes can't interleave and corrupt ordering.
   *
   * Returns the persisted event, or null if the run no longer exists.
   */
  async appendProgress(
    runId: string,
    event: Omit<CopilotProgressEvent, 'id' | 'seq' | 'at'> & { at?: string },
  ): Promise<CopilotProgressEvent | null> {
    return this.dataSource.transaction(async (manager) => {
      const run = await manager.findOne(CopilotRun, {
        where: { id: runId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!run) return null;

      const seq = run.progressSeq ?? 0;
      const full: CopilotProgressEvent = {
        id: uuidv4(),
        seq,
        at: event.at ?? new Date().toISOString(),
        round: event.round,
        segment: event.segment,
        kind: event.kind,
        status: event.status,
        label: (event.label ?? '').slice(0, COPILOT_PROGRESS_LABEL_MAX),
        ...(event.payload
          ? {
              payload: {
                ...event.payload,
                ...(event.payload.reason
                  ? {
                      reason: event.payload.reason.slice(
                        0,
                        COPILOT_PROGRESS_REASON_MAX,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };

      const capped = capProgressLog([...(run.progressLog ?? []), full]);
      await manager.update(
        CopilotRun,
        { id: runId },
        { progressLog: capped, progressSeq: seq + 1 },
      );
      return full;
    });
  }

  /** Runs stuck in a non-terminal status past the timeout (watchdog sweep). */
  async findStaleRuns(timeoutMinutes: number): Promise<CopilotRun[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * TIME.MINUTE_IN_MS);
    return this.find({
      where: {
        status: In([
          CopilotRunStatus.STARTED,
          CopilotRunStatus.GENERATING,
          CopilotRunStatus.EVALUATING,
          CopilotRunStatus.REFINING,
        ]),
        updatedAt: LessThan(cutoff),
      },
    });
  }

  isEndStatus(status: CopilotRunStatus): boolean {
    return COPILOT_END_STATUSES.includes(status);
  }
}
