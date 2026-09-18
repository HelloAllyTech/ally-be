import { Injectable } from '@nestjs/common';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { LearnMessageAndEventMessage } from '../interface/learn-message.interface';
import { BaseEventProcessor } from 'src/ai/processors/base-processor.interface';
import { LoggerService } from 'src/logger/logger.service';
import { PROCESSOR_EVENT_TYPES } from 'src/ai/constants/processor.constants';

/**
 * Persists one live supervisor note (message_type "supervisor_note") emitted by
 * ally-ai-learn each time the AI supervisor sends the learner a coaching hint
 * mid-session. The learner already has the note — it went over the LiveKit data
 * channel — so this path is purely the durable copy the post-session debrief
 * reads back as context. Mirrors StartMetricsProcessor: resolve the session by
 * room_id, skip previews, no-op when the session isn't found.
 */
@Injectable()
export class SupervisorNoteProcessor extends BaseEventProcessor {
  private readonly logger = LoggerService.getInstance(
    SupervisorNoteProcessor.name,
  );

  constructor(private readonly scenarioSessionService: ScenarioSessionService) {
    super();
  }

  getEventType(): string {
    return PROCESSOR_EVENT_TYPES.SUPERVISOR_NOTE;
  }

  async process(data: LearnMessageAndEventMessage): Promise<void> {
    const { room_id, data: learnData } = data;
    const supervisorNote = learnData?.supervisor_note;

    // Previews are ephemeral and have no persisted session — skip quietly.
    if (room_id.startsWith('preview-')) {
      return;
    }

    if (!supervisorNote?.note?.trim()) {
      this.logger.warn(`Supervisor note payload missing for room: ${room_id}`);
      return;
    }

    // seq is the idempotency key and the debrief's read order — a note without
    // one cannot be stored safely, so drop it rather than inventing a position.
    if (!Number.isInteger(supervisorNote.seq) || supervisorNote.seq < 1) {
      this.logger.warn(
        `Supervisor note has no usable seq for room ${room_id}: ` +
          `${String(supervisorNote.seq)}`,
      );
      return;
    }

    try {
      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomIdOrNull(
          room_id,
        );

      if (!scenarioSession) {
        // The session row may be gone (a note racing teardown) or this is a
        // non-session room. Drop the note rather than failing the SQS message —
        // the learner has already seen it.
        this.logger.warn(
          `Scenario session not found for supervisor note: ${room_id}`,
        );
        return;
      }

      await this.scenarioSessionService.addSupervisorNote(
        scenarioSession,
        supervisorNote,
      );
      this.logger.debug(
        `Supervisor note saved: session=${scenarioSession.id} ` +
          `seq=${supervisorNote.seq} chars=${supervisorNote.note.length}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process supervisor note for ${room_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }
}
