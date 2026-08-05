import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';

/**
 * Persists the agent's end-of-session episodic memory (message_type
 * "session_memory") emitted once per session by ally-ai-learn onto the
 * scenario_session_details row (sessionMemory jsonb, atomic upsert). This is
 * the durable source getPreviousCaseMemory prefers when building the next
 * case session's previousMemory. Mirrors TurnMetricsProcessor: resolve the
 * session by room_id, skip previews, no-op when the session isn't found.
 */
@Injectable()
export class SessionMemoryProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    SessionMemoryProcessor.name,
  );

  constructor(private readonly scenarioSessionService: ScenarioSessionService) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.SESSION_MEMORY;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    const { room_id, data: learnData } = data;
    const sessionMemory = learnData?.session_memory;

    // Previews are ephemeral and have no persisted session — skip quietly.
    if (room_id.startsWith('preview-')) {
      return;
    }

    if (!sessionMemory?.summary?.trim()) {
      this.logger.warn(`Session memory payload missing for room: ${room_id}`);
      return;
    }

    try {
      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          room_id,
        );

      if (!scenarioSession) {
        // The session row may not exist yet (race) or this is a non-session
        // room. Drop the memory rather than failing the SQS message.
        this.logger.warn(
          `Scenario session not found for session memory: ${room_id}`,
        );
        return;
      }

      // Outer message timestamp is unix seconds.
      const receivedAt = data.timestamp
        ? new Date(data.timestamp * 1000)
        : undefined;
      await this.scenarioSessionService.addSessionMemory(
        scenarioSession,
        sessionMemory,
        receivedAt,
      );
      this.logger.debug(
        `Session memory saved: session=${scenarioSession.id} ` +
          `chars=${sessionMemory.summary.length} ` +
          `coverage=${sessionMemory.summarized_message_count ?? '?'}/${
            sessionMemory.message_count ?? '?'
          }`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process session memory for ${room_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
