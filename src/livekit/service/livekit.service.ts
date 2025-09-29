import { Injectable } from '@nestjs/common';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from 'livekit-server-sdk';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import {
  DEFAULT_ROOM_TTL,
  MAX_PARTICIPANTS,
} from '../constants/livekit.constants';
import { CreateRoomDto } from '../dto/create-room.dto';
import { JoinRoomDto } from '../dto/join-room.dto';

@Injectable()
export class LiveKitService {
  private readonly logger: LoggerService;
  private roomService!: RoomServiceClient;
  private agentService!: AgentDispatchClient;
  constructor(private readonly configService: AppConfigService) {
    this.logger = LoggerService.getInstance(LiveKitService.name);
    this.initializeRoomService();
    this.initializeAgentService();
  }

  initializeRoomService() {
    const { serverUrl, apiKey, apiSecret } = this.configService.livekit;
    if (!serverUrl || !apiKey || !apiSecret) {
      this.logger.warn(
        'LiveKit configuration missing. Service will not be available.',
      );
      return;
    }

    this.roomService = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    this.logger.debug('LiveKit room service initialized');
  }

  initializeAgentService() {
    const { serverUrl, apiKey, apiSecret } = this.configService.livekit;
    if (!serverUrl || !apiKey || !apiSecret) {
      this.logger.warn(
        'LiveKit configuration missing. Service will not be available.',
      );
      return;
    }
    this.agentService = new AgentDispatchClient(serverUrl, apiKey, apiSecret);
    this.logger.debug('LiveKit agent service initialized');
  }

  async createRoom(createRoomDto: CreateRoomDto) {
    try {
      const roomName = `${createRoomDto.name}`;

      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: createRoomDto.ttl || DEFAULT_ROOM_TTL,
        maxParticipants: createRoomDto.maxParticipants || MAX_PARTICIPANTS,
        metadata: createRoomDto.metadata
          ? JSON.stringify(createRoomDto.metadata)
          : undefined,
      });

      this.logger.debug(`Room created: ${room.name}`);
      return room;
    } catch (error) {
      this.logger.error(
        `Failed to create room: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }

  async deleteRoom(roomName: string) {
    try {
      const fullRoomName = `${roomName}`;
      await this.roomService.deleteRoom(fullRoomName);
      this.logger.debug(`Room deleted: ${fullRoomName}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete room: ${JSON.stringify(error.message)}`,
      );
      throw error;
    }
  }

  async generateAccessToken(joinRoomDto: JoinRoomDto) {
    try {
      const apiKey = this.configService.livekit.apiKey;
      const apiSecret = this.configService.livekit.apiSecret;
      const serverUrl = this.configService.livekit.serverUrl;

      if (!apiKey || !apiSecret) {
        throw new Error('LiveKit API credentials not configured');
      }

      const roomName = `${joinRoomDto.roomName}`;

      const token = new AccessToken(apiKey, apiSecret, {
        identity:
          joinRoomDto.participantIdentity || joinRoomDto.participantName,
        name: joinRoomDto.participantName,
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
      });

      return {
        token: await token.toJwt(),
        roomName,
        serverUrl,
      };
    } catch (error) {
      this.logger.error(
        'Failed to generate access token:',
        JSON.stringify(error.message),
      );
      throw error;
    }
  }

  async listRooms() {
    try {
      const rooms = await this.roomService.listRooms();
      return rooms;
    } catch (error) {
      this.logger.error(`Failed to list rooms: ${error.message}`);
      throw error;
    }
  }

  async listParticipants(roomName: string) {
    try {
      const fullRoomName = `${roomName}`;
      const participants =
        await this.roomService.listParticipants(fullRoomName);
      this.logger.debug(`Listed participants for room: ${fullRoomName}`);
      return participants;
    } catch (error) {
      this.logger.error(
        `Failed to list participants for room ${roomName}: ${error.message}`,
      );
      throw error;
    }
  }

  async removeParticipant(roomName: string, participantIdentity: string) {
    try {
      const fullRoomName = `${roomName}`;
      await this.roomService.removeParticipant(
        fullRoomName,
        participantIdentity,
      );
      this.logger.debug(
        `Removed participant ${participantIdentity} from room: ${fullRoomName}`,
      );
      return { message: 'Participant removed successfully' };
    } catch (error) {
      this.logger.error(
        `Failed to remove participant ${participantIdentity} from room ${roomName}: ${error.message}`,
      );
      throw error;
    }
  }

  async agentDispatch(
    roomName: string,
    participantIdentity: string,
    metadata?: string,
  ) {
    try {
      await this.agentService.createDispatch(roomName, participantIdentity, {
        metadata,
      });
      this.logger.debug(`Agent dispatched to room: ${roomName}`);
    } catch (error) {
      this.logger.error(
        `Failed to dispatch agent to room ${roomName}: ${error.message}`,
      );
      throw error;
    }
  }
}
