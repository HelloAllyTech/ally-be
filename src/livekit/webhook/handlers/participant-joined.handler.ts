import { Injectable } from '@nestjs/common';
import { LiveKitService } from '../../service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { ScenarioSessionService } from 'src/learn/service/scenario-session.service';
import { AppConfigService } from 'src/config/config.service';
import { generateAudioStorageKey } from 'src/common/util/audio.util';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { convertTimestampNsToDate } from 'src/common/util/date.util';

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
  private static dispatchesInProgress = new Set<string>();

  constructor(
    private readonly liveKitService: LiveKitService,
    private readonly scenarioSessionService: ScenarioSessionService,
    private readonly scenarioSharedService: ScenarioSharedService,
    private readonly configService: AppConfigService,
  ) {}

  async handle(event: ParticipantJoinedEvent): Promise<void> {
    try {
      this.logger.info(
        `Processing participant_joined event ${JSON.stringify(event)} for ${event.participant.identity} in room ${event.room.name}`,
      );

      const roomName = event.room.name;

      if (event.participant.kind === ParticipantInfo_Kind.AGENT) {
        // Agent joined the room - clean up both tracking sets
        ParticipantJoinedHandler.dispatchesInProgress.delete(roomName);
        this.liveKitService.clearProactiveDispatch(roomName);
      }

      if (event.participant.kind !== ParticipantInfo_Kind.AGENT) {
        // If human joins, check if we should dispatch an agent

        // 1. Check local "in progress" set to avoid rapid-fire double dispatches (race condition fix)
        if (ParticipantJoinedHandler.dispatchesInProgress.has(roomName)) {
          this.logger.info(
            `Agent dispatch already in progress for room ${roomName}, skipping.`,
          );
          return;
        }

        // 2. Check if a proactive dispatch is already in flight or the agent has
        //    physically joined. The service-level flag covers the race window where
        //    the agent was dispatched but hasn't appeared in listParticipants() yet.
        let agentAlreadyPresent =
          this.liveKitService.isProactiveDispatchPending(roomName);

        if (!agentAlreadyPresent) {
          try {
            const participants =
              await this.liveKitService.listParticipants(roomName);
            agentAlreadyPresent = participants.some(
              (p) => p.kind === ParticipantInfo_Kind.AGENT,
            );
          } catch (listError) {
            this.logger.error(
              `Failed to check existing participants in room ${roomName}: ${listError.message}`,
            );
            // Proceed with dispatch as fallback if check fails
          }
        }

        // Resolve session and record startedAt regardless of whether we dispatch —
        // proactive dispatch skips the normal dispatch path but startedAt must
        // still be persisted when the human actually joins.
        let scenarioSessionStartedAt = new Date();
        const isPreviewRoom = roomName.startsWith('preview');
        const scenarioSession = isPreviewRoom
          ? null
          : await this.scenarioSessionService.getScenarioSessionByRoomId(
              roomName,
            );

        if (
          scenarioSession &&
          this.configService.featureFlag.scenarioSessionAudioRecording
        ) {
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
          if (!event.room.active_recording) {
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
              this.logger.info(`Audio recording started for room ${roomName}`);

              if (egressInfo.startedAt) {
                scenarioSessionStartedAt = convertTimestampNsToDate(
                  egressInfo.startedAt,
                );
              }

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
        }

        if (scenarioSession && !scenarioSession.startedAt) {
          await this.scenarioSessionService.updateScenarioSession(
            scenarioSession.id,
            {
              startedAt: scenarioSessionStartedAt,
            },
          );
        }

        // Agent was pre-dispatched — nothing left to do.
        if (agentAlreadyPresent) {
          this.logger.info(
            `Agent already present in room ${roomName} (proactive dispatch), skipping re-dispatch`,
          );
          return;
        }

        // Mark dispatch as in-progress BEFORE awaiting the dispatch call
        ParticipantJoinedHandler.dispatchesInProgress.add(roomName);

        // Set a safety timeout to eventually clear it if the agent fails to join
        setTimeout(() => {
          ParticipantJoinedHandler.dispatchesInProgress.delete(roomName);
        }, 30000); // 30s safety window

        let metadata: any = {};
        const participantIdentity = this.configService.livekit.agentName;

        if (event.room.metadata && event.room.metadata.trim() !== '') {
          metadata = JSON.parse(event.room.metadata);
        } else {
          this.logger.info(
            'Room metadata is empty or null, using default values',
          );
        }

        const conversationStartedAt = new Date(
          scenarioSession?.startedAt ?? scenarioSessionStartedAt,
        ).toISOString();

        if (!metadata.scenarioSession) {
          metadata.scenarioSession = {};
        }
        metadata.scenarioSession.conversationStartedAt = conversationStartedAt;
        this.logger.info(`Parsed metadata: ${JSON.stringify(metadata)}`);

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
    } catch (error) {
      this.logger.error(
        `Error handling participant_joined event: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
