import { Injectable } from '@nestjs/common';
import { LiveKitService } from '../../service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { AppConfigService } from 'src/config/config.service';
import { generateAudioStorageKey } from 'src/common/util/audio.util';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';

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
    activeRecording: boolean;
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
  private static dispatchesInProgress = new Set<string>();
  private static activeScenarioSessionRecordings = new Set<string>();

  constructor(
    private readonly liveKitService: LiveKitService,
    private readonly scenarioSessionService: ScenarioSessionService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly configService: AppConfigService,
  ) {}

  static isAgentDispatchInProgress(roomName: string): boolean {
    return ParticipantJoinedHandler.dispatchesInProgress.has(roomName);
  }

  static markAgentDispatchInProgress(roomName: string): void {
    ParticipantJoinedHandler.dispatchesInProgress.add(roomName);
  }

  /** Clears in-progress dispatch tracking so another path (e.g. egress) can retry. */
  static clearDispatchInProgress(roomName: string): void {
    ParticipantJoinedHandler.dispatchesInProgress.delete(roomName);
  }

  static isScenarioSessionRecordingInProgress(
    scenarioSessionId: string,
  ): boolean {
    return ParticipantJoinedHandler.activeScenarioSessionRecordings.has(
      scenarioSessionId,
    );
  }

  static markScenarioSessionRecordingInProgress(
    scenarioSessionId: string,
  ): void {
    ParticipantJoinedHandler.activeScenarioSessionRecordings.add(
      scenarioSessionId,
    );
  }

  static clearScenarioSessionRecordingInProgress(
    scenarioSessionId: string,
  ): void {
    ParticipantJoinedHandler.activeScenarioSessionRecordings.delete(
      scenarioSessionId,
    );
  }

  private async dispatchAgent(roomName: string, metadata: any): Promise<void> {
    // If human joins, check if we should dispatch an agent

    // 1. Check local "in progress" set to avoid rapid-fire double dispatches (race condition fix)
    if (ParticipantJoinedHandler.dispatchesInProgress.has(roomName)) {
      this.logger.info(
        `Agent dispatch already in progress for room ${roomName}, skipping.`,
      );
      return;
    }

    // 2. Check if agent is already present in the room as a participant
    try {
      const participants = await this.liveKitService.listParticipants(roomName);
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

    // Mark dispatch as in-progress BEFORE awaiting the dispatch call
    ParticipantJoinedHandler.dispatchesInProgress.add(roomName);

    // Set a safety timeout to eventually clear it if the agent fails to join
    setTimeout(() => {
      ParticipantJoinedHandler.dispatchesInProgress.delete(roomName);
    }, 30000); // 30s safety window

    const participantIdentity = 'Agent';
    try {
      await this.liveKitService.agentDispatch(
        roomName,
        participantIdentity,
        JSON.stringify(metadata),
      );
      this.logger.info(
        `Successfully dispatched agent for participant ${participantIdentity} in room ${roomName}`,
      );
    } catch (dispatchError) {
      // If dispatch fails, clear it from in-progress so we can retry on next join
      ParticipantJoinedHandler.dispatchesInProgress.delete(roomName);
      throw dispatchError;
    }
  }

  async handle(event: ParticipantJoinedEvent): Promise<void> {
    try {
      this.logger.info(
        `Processing participant_joined event ${JSON.stringify(event)} for ${event.participant.identity} in room ${event.room.name}`,
      );

      const roomName = event.room.name;

      if (event.participant.kind === ParticipantInfo_Kind.AGENT) {
        ParticipantJoinedHandler.clearDispatchInProgress(roomName);
      }

      if (event.participant.kind !== ParticipantInfo_Kind.AGENT) {
        const scenarioSession =
          await this.scenarioSessionService.getScenarioSessionByRoomId(
            roomName,
          );
        if (this.configService.featureFlag.scenarioSessionAudioRecording) {
          const { bucket, region, accessKey, secret } =
            this.configService.scenarioSessionAudioStorage;
          if (!bucket || !region || !accessKey || !secret) {
            this.logger.error(
              'Scenario session audio storage configuration is missing',
            );
            return;
          }
          const filepath = generateAudioStorageKey({
            key: roomName,
            extension: 'ogg',
            prefix: 'recordings',
          });
          if (
            !ParticipantJoinedHandler.isScenarioSessionRecordingInProgress(
              scenarioSession.id,
            )
          ) {
            ParticipantJoinedHandler.markScenarioSessionRecordingInProgress(
              scenarioSession.id,
            );
            try {
              const egressInfo =
                await this.liveKitService.startRoomCompositeEgress({
                  roomName,
                  filepath,
                  bucket,
                  region,
                  accessKey,
                  secret,
                });
              this.logger.info(
                `Egress: ${egressInfo.egressId} started for room ${roomName}`,
              );

              const savedRecording =
                await this.scenarioSharedService.saveScenarioSessionRecording({
                  scenarioSessionId: scenarioSession.id,
                  storageKey: filepath,
                  tenantId: scenarioSession.tenantId,
                  egressId: egressInfo.egressId,
                });
              this.logger.info(
                `Scenario session recording saved: ${savedRecording.id}`,
              );
            } catch (egressError) {
              this.logger.error(
                `Failed to start audio recording for room ${roomName}: ${egressError.message}`,
              );
            }
          }
        } else {
          let metadata: any = {};

          if (event?.room?.metadata && event.room.metadata.trim() !== '') {
            metadata = JSON.parse(event.room.metadata);
          } else {
            this.logger.info(
              'Room metadata is empty or null, using default values',
            );
          }
          this.scenarioSessionService.updateScenarioSession(
            scenarioSession.id,
            {
              startedAt: new Date(),
            },
          );
          await this.dispatchAgent(roomName, metadata);
          this.logger.info(
            `Successfully dispatched agent for participant ${event.participant.identity} in room ${roomName}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error handling participant_joined event: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
