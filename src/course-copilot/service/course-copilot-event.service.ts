import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { CourseCopilotEvent } from '../entity/course-copilot-event.entity';
import { CourseCopilotEventType } from '../enum/course-copilot.enum';
import { CourseCopilotEventRepository } from '../repository/course-copilot.repository';
import { COURSE_COPILOT_EVENT_PAYLOAD_MAX_BYTES } from '../constants/course-copilot.constants';
import { CourseCopilotEventView } from '../type/course-copilot-api.type';

export type CourseCopilotEventListener = (
  sessionId: string,
  events: CourseCopilotEventView[],
) => void;

/**
 * The build's progress log, and the seam the gateway pushes from.
 *
 * Copy of Builder's event service: the listener indirection keeps this free of
 * any socket dependency, so the build runner and its tests never drag a
 * WebSocket server behind them. A push only reaches clients connected to THIS
 * process — the admin app polls `GET sessions/:id?afterSeq=` while building,
 * which is the guarantee; the socket is the speed-up.
 */
@Injectable()
export class CourseCopilotEventService {
  private readonly logger = LoggerService.getInstance(
    CourseCopilotEventService.name,
  );
  private listener: CourseCopilotEventListener | null = null;

  constructor(private readonly eventRepository: CourseCopilotEventRepository) {}

  addListener(listener: CourseCopilotEventListener): void {
    this.listener = listener;
  }

  removeListener(): void {
    this.listener = null;
  }

  /**
   * Record and push. Never throws: progress telemetry failing must not fail
   * the job that produced it.
   */
  async record(
    sessionId: string,
    type: CourseCopilotEventType,
    payload: Record<string, any> = {},
  ): Promise<void> {
    try {
      const saved = await this.eventRepository.appendBatch(sessionId, [
        { type, payload: this.truncate(payload) },
      ]);
      this.push(sessionId, saved);
    } catch (error) {
      this.logger.warn(
        `Course Copilot event ${type} for ${sessionId} not recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async listAfter(
    sessionId: string,
    afterSeq: number,
    limit = 200,
  ): Promise<CourseCopilotEventView[]> {
    const rows = await this.eventRepository.listAfter(
      sessionId,
      afterSeq,
      limit,
    );
    return rows.map((row) => this.toView(row));
  }

  toView(event: CourseCopilotEvent): CourseCopilotEventView {
    return {
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      createdAt: new Date(event.createdAt).toISOString(),
    };
  }

  private push(sessionId: string, events: CourseCopilotEvent[]): void {
    if (!this.listener || !events.length) return;
    try {
      this.listener(
        sessionId,
        events.map((event) => this.toView(event)),
      );
    } catch (error) {
      this.logger.warn(
        `Course Copilot event push failed for ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Cap a payload; truncation is marked so a reader knows it was cut. */
  private truncate(payload: Record<string, any>): Record<string, any> {
    const serialised = JSON.stringify(payload ?? {});
    if (serialised.length <= COURSE_COPILOT_EVENT_PAYLOAD_MAX_BYTES) {
      return payload;
    }
    const result: Record<string, any> = {};
    let budget = COURSE_COPILOT_EVENT_PAYLOAD_MAX_BYTES;
    for (const [key, value] of Object.entries(payload)) {
      const size = JSON.stringify(value ?? null).length;
      if (size > budget) {
        result[key] =
          typeof value === 'string'
            ? `${value.slice(0, Math.max(0, budget))}…[truncated]`
            : '…[truncated]';
        budget = 0;
        continue;
      }
      result[key] = value;
      budget -= size;
    }
    result.truncated = true;
    return result;
  }
}
