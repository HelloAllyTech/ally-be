import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from '../../logger/logger.service';
import { ChatService } from '../../chat/service/chat.service';
import { AudioIngestInterface } from '../interface/audio-ingest.interface';
import { ExotelStreamEvents } from '../type/audio-ingest.type';
import { UserChatSessionData } from '../../chat/type/chat.type';
import { NotificationErrorType } from '../../notification/type/notification.error.type';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { TWENTY_FIVE_SECONDS_IN_MS } from '../../common/constants/time.constants';
import { AudioChatProvider } from '../../common/constants/chat.constants';
import {
  PLACEHOLDER_CHAT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { UserService } from 'src/user/user.service';
import { EXOTEL_SAMPLE_RATE } from '../constants/audio-ingest.constants';

@Injectable()
export class ExotelConferenceCallService implements AudioIngestInterface {
  private readonly logger = LoggerService.getInstance(
    ExotelConferenceCallService.name,
  );

  private sessions: { [key: string]: UserChatSessionData } = {};
  private keepAliveData: {
    [key: string]: {
      interval: NodeJS.Timeout;
      sequence: number;
    };
  } = {};

  private readonly BYTES_PER_20MS = 320; // Each 20ms chunk must be 320 bytes
  private readonly MIN_CHUNKS = 10; // Minimum 10 chunks for 3.2KB (100ms)

  constructor(
    private chatService: ChatService,
    private userService: UserService,
    private eventEmitter: EventEmitter2,
    private streamFileProcessorService: StreamFileProcessorService,
  ) {}

  async handleStreamEvent(messageData: any, ws: WebSocket) {
    if (messageData.event === ExotelStreamEvents.START) {
      await this.startCall(messageData, ws);
    }

    if (messageData.event === ExotelStreamEvents.MEDIA) {
      await this.handleAudioMessage(messageData, ws);
    }

    if (messageData.event === ExotelStreamEvents.STOP) {
      await this.endCall(messageData.stream_sid);
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async startCall(messageData: any, ws: WebSocket) {
    const streamSid = messageData.stream_sid;

    this.logger.info(
      `Exotel: WS client start event triggered with stream_sid: ${streamSid} and message: ${JSON.stringify(messageData)}`,
    );

    this.sessions[streamSid] = {
      id: streamSid,
      chatId: PLACEHOLDER_CHAT_ID,
      type: 'user',
      userId: -1,
      user: null,
      role: UserRole.COUNSELOR,
      room: 'placeholder-room',
      tenantId: 'default',
      provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
    };

    let counselorPhone = messageData.start?.from;
    if (!counselorPhone) {
      this.logger.warn('Missing counselor phone number');
      this.eventEmitter.emit('exception', {
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: 'Start call',
        message: `Missing counselor phone number`,
        type: 'Exotel integration error',
      } as NotificationErrorType);

      ws.terminate();
      delete this.sessions[streamSid];
      this.streamFileProcessorService.clearPendingAudioQueue(streamSid);
      return;
    }

    // Format Indian phone numbers
    if (counselorPhone.startsWith('0')) {
      counselorPhone = `+91${counselorPhone.substring(1)}`; // Remove 0 and add +91
    } else if (
      !counselorPhone.startsWith('+91') &&
      counselorPhone.length === 10
    ) {
      counselorPhone = `+91${counselorPhone}`; // Add +91 prefix
    }

    const counselor =
      await this.userService.getUserByPhoneNumber(counselorPhone);

    if (!counselor) {
      this.eventEmitter.emit('exception', {
        statusCode: 404,
        timestamp: new Date().toISOString(),
        path: 'Start call',
        message: `Counselor with phone number ${counselorPhone} not found`,
        type: 'Exotel integration error',
      } as NotificationErrorType);

      ws.terminate();
      delete this.sessions[streamSid];
      this.streamFileProcessorService.clearPendingAudioQueue(streamSid);
      return;
    }

    const session = {
      userId: counselor.id,
      room: `user-${counselor.id}`,
      tenantId: counselor.tenantId,
    };

    const updatedSession = {
      ...this.sessions[streamSid],
      ...session,
    };

    // Store session data
    this.sessions[streamSid] = updatedSession;

    this.setAuthContext(updatedSession);

    // Start call stream with chat creation in transaction
    try {
      await this.streamFileProcessorService.startCallStream(
        updatedSession,
        {
          counselorId: session.userId,
          provider: AudioChatProvider.EXOTEL_CONFERENCE_CALL,
          sampleRate: EXOTEL_SAMPLE_RATE,
        },
        (chatId: number) => {
          // Update session with chatId
          this.sessions[streamSid] = {
            ...this.sessions[streamSid],
            chatId,
          };

          this.logger.info(
            `Chat created for user ${session.userId} with chatId ${chatId}`,
          );
        },
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to start call stream for client ${streamSid}: with error ${JSON.stringify(
          error,
        )}`,
      );
      ws.terminate();
      delete this.sessions[streamSid];
      return;
    }

    this.logger.info(
      `Exotel: WS client start event completed with stream_sid: ${streamSid}`,
    );
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioMessage(msg: any, ws: WebSocket) {
    const streamSid = msg.stream_sid;

    const session = this.sessions[streamSid];
    if (!session) {
      this.logger.warn(`Exotel: No session found for stream_sid: ${streamSid}`);
      return;
    }

    const isChatCreated = session.chatId !== PLACEHOLDER_CHAT_ID;
    if (isChatCreated) {
      const isChatPaused = await this.chatService.isChatPaused(session.chatId);
      if (isChatPaused) {
        this.logger.info(
          `Exotel: Chat is paused for chatId: ${session.chatId}`,
        );
        return;
      }

      const isChatEnded = await this.chatService.isChatEnded(session.chatId);
      if (isChatEnded) {
        this.logger.info(`Exotel: Chat is ended for chatId: ${session.chatId}`);
        ws.terminate();
        return;
      }
    }

    const audioData = msg.media?.payload;

    if (!audioData) {
      this.logger.warn(
        `Exotel: No audio data found for stream_sid: ${streamSid}`,
      );
      return;
    }

    this.streamFileProcessorService.saveAudio(session, {
      chatId: session.chatId,
      audioBase64: audioData,
      shouldBroadcastAudioMessage: true,
    });
  }

  private createEmptyPCMAudioPacket(): string {
    // Create minimum required size (3.2KB = 10 chunks of 320 bytes)
    const minSize = this.BYTES_PER_20MS * this.MIN_CHUNKS; // 3.2KB
    const buffer = Buffer.alloc(minSize);

    // Each 320-byte chunk contains 160 samples (320/2 bytes per sample)
    const samplesPerChunk = this.BYTES_PER_20MS / 2; // 160 samples per 20ms
    const totalSamples = samplesPerChunk * this.MIN_CHUNKS; // 1600 samples for 100ms

    // Fill with zeros (silence) in little-endian format
    for (let i = 0; i < totalSamples; i++) {
      buffer.writeInt16LE(0, i * 2); // 2 bytes per sample
    }

    // Convert to base64 as required by Exotel
    return buffer.toString('base64');
  }

  handleConnectionAlive(ws: WebSocket, messageData: any) {
    const streamId = messageData.stream_sid;
    if (!streamId || this.keepAliveData[streamId]?.interval) {
      return;
    }
    // Send empty audio packet every 25 seconds back to exotel to keep the connection alive
    const emptyAudioPacket = this.createEmptyPCMAudioPacket();
    const intervalId = setInterval(() => {
      const sequence = this.keepAliveData[streamId]?.sequence;
      const streamData = {
        event: ExotelStreamEvents.MEDIA,
        sequence_number: sequence.toString(),
        stream_sid: streamId,
        media: {
          chunk: sequence.toString(),
          timestamp: Date.now().toString(),
          payload: emptyAudioPacket,
        },
      };
      ws.send(JSON.stringify(streamData));
      this.keepAliveData[streamId].sequence++;
    }, TWENTY_FIVE_SECONDS_IN_MS);
    this.keepAliveData[streamId] = {
      interval: intervalId,
      sequence: 1,
    };
  }

  private clearKeepAliveData(id: string) {
    if (this.keepAliveData[id]?.interval) {
      clearInterval(this.keepAliveData[id].interval);
    }

    if (this.keepAliveData[id]) {
      delete this.keepAliveData[id];
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async endCall(streamSid: string) {
    this.logger.info(
      `Exotel: WS client stop event triggered with stream_sid: ${streamSid}`,
    );
    if (!streamSid) {
      this.logger.warn('Exotel: Missing client ID');
      return;
    }
    const session = this.sessions[streamSid];
    if (!session) {
      this.logger.warn(`Exotel: No session found for stream_sid: ${streamSid}`);
      return;
    }

    this.setAuthContext(session);

    this.chatService.endChat(session.chatId);

    this.clearKeepAliveData(streamSid);
    delete this.sessions[streamSid];

    this.logger.info(
      `Exotel: WS client stop event completed with stream_sid: ${streamSid}`,
    );
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.tenantId,
    );
  }
}
