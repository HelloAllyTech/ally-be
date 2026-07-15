import { Injectable } from '@nestjs/common';
import { ScenarioSessionStatus } from 'src/learn/enum/scenario-session-status.enum';
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
        await this.scenarioSessionService.endScenarioSession(
          scenarioSession.id,
          scenarioSession.counselorId,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle room finished: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
