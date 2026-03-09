import { Injectable } from '@nestjs/common';
import { LiveKitService } from '../../service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';

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
    kind: number;
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
  private readonly logger = new LoggerService(ParticipantJoinedHandler.name);

  constructor(
    private readonly liveKitService: LiveKitService,
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  async handle(event: ParticipantJoinedEvent): Promise<void> {
    try {
      this.logger.info(
        `Processing participant_joined event ${JSON.stringify(event)} for ${event.participant.identity} in room ${event.room.name}`,
      );

      const roomName = event.room.name;

      let metadata: any = {};
      const participantIdentity = 'Agent';

      if (event.room.metadata && event.room.metadata.trim() !== '') {
        metadata = JSON.parse(event.room.metadata);
        this.logger.info(`Parsed metadata: ${JSON.stringify(metadata)}`);
      } else {
        this.logger.info(
          'Room metadata is empty or null, using default values',
        );
      }

      if (event.participant.kind === ParticipantInfo_Kind.AGENT) {
        const scenarioSession =
          await this.scenarioSessionService.getScenarioSessionByRoomId(
            roomName,
          );
        if (!scenarioSession.startedAt) {
          const startedAt = new Date();
          await this.scenarioSessionService.updateScenarioSession(
            scenarioSession.id,
            {
              startedAt,
            },
          );
        }
      }

      if (event.participant.kind !== ParticipantInfo_Kind.AGENT) {
        // Check if agent is already present in the room
        try {
          const participants =
            await this.liveKitService.listParticipants(roomName);
          const hasAgent = participants.some(
            (p) => p.kind === ParticipantInfo_Kind.AGENT,
          );

          if (hasAgent) {
            this.logger.info(
              `Agent already present in room ${roomName}, skipping dispatch`,
            );
            return;
          }
        } catch (listError) {
          this.logger.error(
            `Failed to check existing participants in room ${roomName}: ${listError.message}`,
          );
          // Proceed with dispatch as fallback if check fails?
          // Better to proceed than to have a dead room if check fails due to transient issue.
        }

        await this.liveKitService.agentDispatch(
          roomName,
          participantIdentity,
          JSON.stringify(metadata),
        );
      }

      this.logger.info(
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
