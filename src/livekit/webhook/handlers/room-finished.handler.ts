import { Injectable } from '@nestjs/common';
import {
  ScenarioSessionAbandonReason,
  ScenarioSessionStatus,
} from 'src/learn/enum/scenario-session-status.enum';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { ScenarioSessionLifecycleEventType } from 'src/learn/entity/scenario-session-lifecycle-event.entity';
import { LoggerService } from 'src/logger/logger.service';

export interface RoomFinishedEvent {
  event: 'room_finished';
  room: {
    name: string;
    sid: string;
    creation_time: number;
    empty_timeout: number;
    max_participants: number;
    num_participants: number;
    num_publishers: number;
    active_recording: boolean;
    metadata: string;
  };
  id: string;
  created_at: number;
}

@Injectable()
export class RoomFinishedHandler {
  private readonly logger = new LoggerService(RoomFinishedHandler.name);

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  async handle(event: RoomFinishedEvent): Promise<void> {
    this.logger.info(`Room finished: ${event.room?.name}`);

    try {
      if (!event.room?.name) {
        this.logger.warn('Room name is missing in room finished event');
        return;
      }

      if (event.room.name.startsWith('preview-')) {
        await this.scenarioSessionService.endPreviewScenario(event.room.name);
        return;
      }

      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomId(
          event.room.name,
        );

      void this.scenarioSessionService.recordLifecycleEvent(
        scenarioSession.id,
        ScenarioSessionLifecycleEventType.ROOM_FINISHED,
      );

      if (scenarioSession.status !== ScenarioSessionStatus.ENDED) {
        // Reaching here means the ROOM closed while the session was still live —
        // nobody ended it. `endScenarioSession` deletes the room itself, which is
        // what fires this webhook on a normal end, and in that case the session is
        // already ENDED and this branch is skipped. So this is the one place a
        // crash (agent died, learner's connection dropped, LiveKit's empty-timeout
        // fired) is actually detectable.
        //
        // The full end flow still runs: the learner's practice minutes, credits
        // and transcript are real and must be recorded exactly as before. What is
        // added is the LABEL, which is the part that was missing — this used to
        // force `status = ENDED` and never touch `eventStatus`, leaving the row
        // identical to a session that ended cleanly but whose agent SQS event was
        // merely late.
        await this.scenarioSessionService.endScenarioSession(
          scenarioSession.id,
          scenarioSession.counselorId,
        );

        // AFTER the end flow, not before: `endScenarioSession` writes `status`
        // and (via `handleEndScenarioSessionEvent`, if that message ever arrives)
        // `eventStatus`, and this must not be overwritten by it.
        //
        // Marked best-effort — a failure to label must never undo an end that
        // already succeeded, which would be a strictly worse outcome than an
        // unlabelled row.
        try {
          await this.scenarioSessionService.markSessionAbandoned(
            scenarioSession.id,
            ScenarioSessionAbandonReason.ROOM_FINISHED_WITHOUT_END,
          );
        } catch (error) {
          this.logger.error(
            `Ended session ${scenarioSession.id} but could not label it ` +
              `abandoned: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle room finished: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
