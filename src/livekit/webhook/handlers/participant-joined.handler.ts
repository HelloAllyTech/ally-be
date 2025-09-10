import { Injectable, Logger } from '@nestjs/common';
import { LiveKitService } from '../../service/livekit.service';

export interface ParticipantJoinedEvent {
  event: 'participant_joined';
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
  participant: {
    sid: string;
    identity: string;
    name: string;
    metadata: string;
    joined_at: number;
    version: number;
    permission: {
      can_subscribe: boolean;
      can_publish: boolean;
      can_publish_data: boolean;
      hidden: boolean;
      recorder: boolean;
    };
  };
  id: string;
  created_at: number;
}

@Injectable()
export class ParticipantJoinedHandler {
  private readonly logger = new Logger(ParticipantJoinedHandler.name);

  constructor(private readonly liveKitService: LiveKitService) {}

  async handle(event: ParticipantJoinedEvent): Promise<void> {
    try {
      this.logger.log(
        `Processing participant_joined event ${JSON.stringify(event)} for ${event.participant.identity} in room ${event.room.name}`,
      );

      const roomName = event.room.name;

      let metadata: any = {};
      let participantIdentity = 'Agent';

      if (event.room.metadata && event.room.metadata.trim() !== '') {
        metadata = JSON.parse(event.room.metadata);
        this.logger.log(`Parsed metadata: ${JSON.stringify(metadata)}`);

        if (metadata.scenario && metadata.scenario.title) {
          participantIdentity = `Agent ${metadata.scenario.title}`;
        }
      } else {
        this.logger.log('Room metadata is empty or null, using default values');
      }

      // Call agentDispatch from LiveKit service
      await this.liveKitService.agentDispatch(
        roomName,
        participantIdentity,
        JSON.stringify(metadata),
      );

      this.logger.log(
        `Successfully dispatched agent for participant ${participantIdentity} in room ${roomName}`,
      );
    } catch (error) {
      this.logger.error(
        `Error handling participant_joined event: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
