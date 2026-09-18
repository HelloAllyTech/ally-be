import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  LIVEKIT_ROOM_METADATA_CAP_BYTES,
  ROOM_METADATA_STALE_HOURS,
  ROOM_METADATA_WARN_BYTES,
} from '../constants/scenario-session.constants';
import { LearnRoomMetadata } from '../entity/learn-room-metadata.entity';

/**
 * Slim envelope placed in LiveKit room + dispatch metadata when fetch-by-id is
 * enabled. The agent resolves `metadataFetch.url` (x-api-key guarded) to get
 * the full envelope; `scenarioSession` fields injected later (e.g. the
 * participant_joined handler's conversationStartedAt) overlay the fetched
 * payload agent-side. Mirrors roleplay v2's `specFetch` contract.
 */
export interface SlimRoomMetadata {
  version: string;
  environment?: string;
  metadataFetch: {
    roomName: string;
    url: string;
  };
}

export interface PreparedRoomMetadata {
  /** What to set as LiveKit room metadata. */
  roomPayload: Record<string, any>;
  /** What to pass as agent dispatch metadata. */
  dispatchPayload: Record<string, any>;
}

/**
 * Store for full room-metadata envelopes, keyed by LiveKit room name.
 *
 * When `learnMetadataFetchEnabled` is on, session/preview start persists the
 * full envelope here and puts only a fetch pointer on the LiveKit room and
 * dispatch — keeping the agent availability request tiny (the full envelope
 * inside it is what blew LiveKit's 3s dispatch window). When off, callers get
 * the full envelope back unchanged (legacy inline behavior).
 */
@Injectable()
export class RoomMetadataStoreService {
  private readonly logger = LoggerService.getInstance(
    RoomMetadataStoreService.name,
  );
  constructor(
    @InjectRepository(LearnRoomMetadata)
    private readonly repository: Repository<LearnRoomMetadata>,
    private readonly configService: AppConfigService,
  ) {}

  /**
   * Persist the full envelope and return the payloads to put on the room and
   * the dispatch. Falls back to legacy inline metadata when the flag is off —
   * or when the store write fails, so a DB hiccup can never block a session.
   */
  async prepareRoomMetadata(
    roomName: string,
    fullEnvelope: Record<string, any>,
  ): Promise<PreparedRoomMetadata> {
    if (!this.configService.learnMetadataFetchEnabled) {
      return this.checked(roomName, {
        roomPayload: fullEnvelope,
        dispatchPayload: fullEnvelope,
      });
    }

    try {
      await this.repository.upsert({ roomName, payload: fullEnvelope }, [
        'roomName',
      ]);
    } catch (error) {
      this.logger.error(
        `[ROOM_METADATA_STORE] persist failed for ${roomName}, falling back to inline metadata: ${error?.message}`,
      );
      return this.checked(roomName, {
        roomPayload: fullEnvelope,
        dispatchPayload: fullEnvelope,
      });
    }

    void this.sweepStaleRows();

    const slim = this.buildSlimEnvelope(roomName, fullEnvelope);
    return this.checked(roomName, {
      roomPayload: slim,
      dispatchPayload: slim,
    });
  }

  /**
   * Measure what is actually going on the LiveKit room, and warn only if THAT
   * breaches the cap.
   *
   * This check used to live in `scenario-shared.service.ts`, against the full
   * envelope — which stopped being the room payload the moment this class
   * started slimming it. It therefore warned about a 65536-byte cap on every
   * session while the real payload was ~223 bytes, and an investigation on
   * 2026-09-17 duly chased it. Here the number is whatever is really being set,
   * on both the fetch-enabled and the inline path, so the warning is only ever
   * about a breach that can actually happen.
   *
   * Deliberately covers the fallback paths too: an inline payload is exactly
   * the case where the cap is a live risk, and it is reached when the flag is
   * off OR when the store write failed — the second being precisely the moment
   * nobody is watching.
   */
  private checked(
    roomName: string,
    prepared: PreparedRoomMetadata,
  ): PreparedRoomMetadata {
    const bytes = Buffer.byteLength(
      JSON.stringify(prepared.roomPayload),
      'utf8',
    );
    if (bytes > LIVEKIT_ROOM_METADATA_CAP_BYTES) {
      this.logger.error(
        `[ROOM_METADATA_SIZE] room payload ${bytes} bytes EXCEEDS the LiveKit cap ` +
          `(${LIVEKIT_ROOM_METADATA_CAP_BYTES}) for ${roomName} — the room is being ` +
          `created with metadata LiveKit may reject or truncate`,
      );
    } else if (bytes > ROOM_METADATA_WARN_BYTES) {
      this.logger.warn(
        `[ROOM_METADATA_SIZE] room payload ${bytes} bytes for ${roomName}, past the ` +
          `${ROOM_METADATA_WARN_BYTES} warn threshold (LiveKit cap ${LIVEKIT_ROOM_METADATA_CAP_BYTES})`,
      );
    } else {
      this.logger.debug(
        `[ROOM_METADATA_SIZE] room payload ${bytes} bytes for ${roomName}`,
      );
    }
    return prepared;
  }

  /** Full envelope for a room, for the agent webhook. 404 when unknown/expired. */
  async getRoomMetadata(roomName: string): Promise<Record<string, any>> {
    const row = await this.repository.findOne({ where: { roomName } });
    if (!row) {
      throw new NotFoundException(
        `No room metadata stored for room ${roomName}`,
      );
    }
    return row.payload;
  }

  private buildSlimEnvelope(
    roomName: string,
    fullEnvelope: Record<string, any>,
  ): SlimRoomMetadata {
    const baseUrl = (this.configService.api.baseUrl ?? '').replace(/\/$/, '');
    return {
      version: `${fullEnvelope.version ?? '1.0'}`,
      // The LiveKit webhook receiver (livekit-webhook.controller.ts) filters
      // every event on room.metadata.environment matching this env's config —
      // the slim envelope must carry it too, or every webhook for a room
      // created under this envelope gets silently dropped.
      environment: fullEnvelope.environment,
      metadataFetch: {
        roomName,
        // main.ts sets setGlobalPrefix('api'), so every route lives under
        // /api/v1/... — API_BASE_URL is the bare origin and does NOT carry it.
        url: `${baseUrl}/api/v1/learn/webhook/room-metadata/${encodeURIComponent(roomName)}`,
      },
    };
  }

  /**
   * Best-effort cleanup of expired rows (rooms live minutes to hours). Runs
   * after each store so no scheduler is needed; uses the createdAt index.
   */
  private async sweepStaleRows(): Promise<void> {
    try {
      await this.repository
        .createQueryBuilder()
        .delete()
        .where(
          `"createdAt" < now() - interval '${ROOM_METADATA_STALE_HOURS} hours'`,
        )
        .execute();
    } catch (error) {
      this.logger.warn(
        `[ROOM_METADATA_STORE] stale-row sweep failed (ignored): ${error?.message}`,
      );
    }
  }
}
