import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
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

export class RoomFinishedHandler {
  private readonly logger = new LoggerService(RoomFinishedHandler.name);

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  async handle(event: RoomFinishedEvent): Promise<void> {
    this.logger.info(`Room finished: ${event.room?.name}`);

    try {
      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomId(
          event.room.name,
        );
      await this.scenarioSessionService.endScenarioSession(
        scenarioSession.id,
        scenarioSession.counselorId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle room finished: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }
}
