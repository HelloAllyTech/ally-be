import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';

/**
 * Persists simulation START latency (message_type "start_metrics") emitted once
 * per session by ally-ai-learn into scenario_session_start_metrics, for the
 * start-latency analytics chart. Mirrors TurnMetricsProcessor: resolve the
 * session by room_id, skip previews, no-op when the session isn't found.
 */
@Injectable()
export class StartMetricsProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    StartMetricsProcessor.name,
  );

  constructor(private readonly scenarioSessionService: ScenarioSessionService) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.START_METRICS;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    const { room_id, data: learnData } = data;
    const startMetrics = learnData?.start_metrics;

    // Previews are ephemeral and have no persisted session — skip quietly.
    if (room_id.startsWith('preview-')) {
      return;
    }

    if (!startMetrics) {
      this.logger.warn(`Start metrics payload missing for room: ${room_id}`);
      return;
    }

    try {
      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          room_id,
        );

      if (!scenarioSession) {
        // The session row may not exist yet (race) or this is a non-session
        // room. Drop the sample rather than failing the SQS message.
        this.logger.warn(
          `Scenario session not found for start metrics: ${room_id}`,
        );
        return;
      }

      // Outer message timestamp is unix seconds; use it as the opening time.
      const occurredAt = data.timestamp
        ? new Date(data.timestamp * 1000)
        : undefined;
      await this.scenarioSessionService.addStartMetrics(
        scenarioSession,
        startMetrics,
        occurredAt,
      );
      this.logger.debug(
        `Start metrics saved: session=${scenarioSession.id} ` +
          `startLatency=${startMetrics.start_latency_ms}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process start metrics for ${room_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
