import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';

/**
 * Persists per-turn latency metrics (message_type "turn_metrics") emitted by
 * ally-ai-learn into scenario_session_turn_metrics, for the latency Metabase
 * dashboards. Mirrors LearnEventProcessor: resolve the session by room_id,
 * skip previews, no-op when the session isn't found.
 */
@Injectable()
export class TurnMetricsProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    TurnMetricsProcessor.name,
  );

  constructor(private readonly scenarioSessionService: ScenarioSessionService) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.TURN_METRICS;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    const { room_id, data: learnData } = data;
    const turnMetrics = learnData?.turn_metrics;

    // Previews are ephemeral and have no persisted session — skip quietly.
    if (room_id.startsWith('preview-')) {
      return;
    }

    if (!turnMetrics) {
      this.logger.warn(`Turn metrics payload missing for room: ${room_id}`);
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
          `Scenario session not found for turn metrics: ${room_id}`,
        );
        return;
      }

      // Outer message timestamp is unix seconds; use it as the turn time.
      const occurredAt = data.timestamp
        ? new Date(data.timestamp * 1000)
        : undefined;
      await this.scenarioSessionService.addTurnMetrics(
        scenarioSession,
        turnMetrics,
        occurredAt,
      );
      this.logger.debug(
        `Turn metrics saved: session=${scenarioSession.id} ` +
          `turn=${turnMetrics.turn_index} latency=${turnMetrics.response_latency_ms}ms`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process turn metrics for ${room_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
