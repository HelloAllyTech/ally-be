import { Injectable } from '@nestjs/common';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { convertTimestampNsToDate } from 'src/common/util/date.util';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantJoinedHandler } from './participant-joined.handler';

export interface EgressStartedEvent {
  event: 'egress_started';
  egressInfo?: {
    egressId?: string;
    roomId?: string;
    roomName?: string;
    startedAt?: bigint;
  };
}

@Injectable()
export class EgressStartedHandler {
  private readonly logger = new LoggerService(EgressStartedHandler.name);

  constructor(
    private readonly liveKitService: LiveKitService,
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  private async dispatchAgent(
    roomName: string,
    metadata: any,
    scenarioSessionId: string,
  ): Promise<void> {
    try {
      // Shared with participant_joined: agent_joined clears in-progress; timeout covers failed dispatch.
      if (ParticipantJoinedHandler.isAgentDispatchInProgress(roomName)) {
        this.logger.info(
          `Agent dispatch already in progress for room ${roomName}, skipping.`,
        );
        return;
      }

      // 2. Check if agent is already present in the room as a participant
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
        // Proceed with dispatch as fallback if check fails
      }

      ParticipantJoinedHandler.markAgentDispatchInProgress(roomName);

      // Set a safety timeout to eventually clear it if the agent fails to join
      setTimeout(() => {
        ParticipantJoinedHandler.clearDispatchInProgress(roomName);
        ParticipantJoinedHandler.clearScenarioSessionRecordingInProgress(
          scenarioSessionId,
        );
      }, 30000);

      const participantIdentity = 'Agent';
      await this.liveKitService.agentDispatch(
        roomName,
        participantIdentity,
        JSON.stringify(metadata),
      );
      this.logger.info(
        `Successfully dispatched agent for participant ${participantIdentity} in room ${roomName}`,
      );
    } catch (dispatchError) {
      ParticipantJoinedHandler.clearDispatchInProgress(roomName);
      ParticipantJoinedHandler.clearScenarioSessionRecordingInProgress(
        scenarioSessionId,
      );
      throw dispatchError;
    }
  }

  async handle(event: EgressStartedEvent): Promise<void> {
    try {
      const { egressId, roomName, startedAt } = event.egressInfo || {};
      this.logger.debug(`Egress started: ${egressId} for room ${roomName}`);

      if (!roomName) {
        this.logger.warn(
          'egress_started webhook missing room_name, skipping agent dispatch',
        );
        return;
      }

      let metadata: any = {};

      const room = await this.liveKitService.getRoomById(roomName);

      if (room?.metadata && room.metadata.trim() !== '') {
        metadata = JSON.parse(room.metadata);
      } else {
        this.logger.info(
          'Room metadata is empty or null, using default values',
        );
      }

      let scenarioSessionStartedAt = new Date();

      if (startedAt) {
        scenarioSessionStartedAt = convertTimestampNsToDate(startedAt);
      }

      const scenarioSession =
        await this.scenarioSessionService.getScenarioSessionByRoomId(roomName);

      if (!scenarioSession.startedAt) {
        await this.scenarioSessionService.updateScenarioSession(
          scenarioSession.id,
          {
            startedAt: scenarioSessionStartedAt,
          },
        );
      }

      const conversationStartedAt = new Date(
        scenarioSession.startedAt ?? scenarioSessionStartedAt,
      ).toISOString();

      if (!metadata.scenarioSession) {
        metadata.scenarioSession = {};
      }
      metadata.scenarioSession.conversationStartedAt = conversationStartedAt;
      this.logger.info(`Parsed metadata: ${JSON.stringify(metadata)}`);

      await this.dispatchAgent(roomName, metadata, scenarioSession.id);
    } catch (error) {
      this.logger.error(`Error in egress_started handler: ${error.message}`);
      throw error;
    }
  }
}
