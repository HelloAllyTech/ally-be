import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../logger/logger.service';
import { Injectable } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import { AudioChatProvider } from '../../common/constants/chat.constants';
import { UserRole } from 'src/common/constants/user.constants';
import { MessagePayload, UserChatSessionData } from '../type/chat.type';
import { ChatEvents } from '../constants/chat.constants';
import { TranscriptionService } from '../../ai/service/transcription.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { MultiSpeakerAudioService } from '../service/multi-speaker-audio.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';
import { Message, MessageType } from '../../common/entities/message.entity';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/microphone-chat',
})
@Injectable()
export class MicrophoneChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = LoggerService.getInstance(
    MicrophoneChatGateway.name,
  );

  private sessions: { [key: string]: UserChatSessionData } = {};
  private connectedUsers = new Set<number>();

  constructor(
    private chatService: ChatService,
    private transcriptionService: TranscriptionService,
    private multiSpeakerAudioService: MultiSpeakerAudioService,
    private publisher: MessageBrokerService,
  ) {}

  @WebSocketServer() server!: Server;

  async handleConnection(client: Socket) {
    this.logger.info(`Client connected to microphone chat: ${client.id}`);

    this.authenticateClient(client);

    client.on('connect_error', (err) => {
      this.logger.error(
        `❌ Connection error for client co ${client.id}:`,
        err.message,
      );
    });

    client.on('disconnect', () => {
      this.logger.info(
        `Client disconnected from microphone chat: ${client.id}`,
      );
      this.handleDisconnect(client);
    });
  }

  async handleDisconnect(client: Socket) {
    this.logger.info(`🔴 Client disconnected: ${client.id}`);
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }
    this.connectedUsers.delete(+session.userId);
    this.transcriptionService.stopLiveTranscription(session);

    if (session.chatId) {
      this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
        participants: [session.userId],
        message: {
          content: 'User disconnected',
          messageType: MessageType.SYSTEM,
          userId: session.userId,
        },
        broadCastOptions: {
          event: ChatEvents.USER_DISCONNECTED,
        },
      });
    }
  }

  sendMessagesToRoom(room: string, payload: MessagePayload) {
    const event = payload.type || ChatEvents.MESSAGE_RECEIVED;
    this.logger.info(
      `Sending message to room: ${room} | event: ${JSON.stringify(event)}`,
    );
    this.server.to(room).emit(event, payload);
  }

  private async sendMessageToParticipant(
    participants: number[],
    message: Message,
    broadCastOptions?: {
      event?: ChatEvents;
    },
  ) {
    if (!participants.length || !message.content) {
      this.logger.error(
        `No participants or message content found for chatId: ${message.chatId} | message: ${message.content}`,
      );
      return;
    }
    participants.forEach((participant) => {
      if (this.connectedUsers.has(participant)) {
        const room = `user-${participant}`;
        this.sendMessagesToRoom(room, {
          type: broadCastOptions?.event || ChatEvents.MESSAGE_RECEIVED,
          payload: message,
        });
      }
    });
  }

  private async authenticateClient(client: Socket) {
    const { userId } = client.handshake.auth?.user || {};
    if (!userId) {
      this.logger.error(`❌ No userId provided for client ${client.id}`);
      client.disconnect();
      return;
    }

    const room = `user-${userId}`;
    client.join(room);

    this.sessions[client.id] = {
      id: client.id,
      userId: +userId,
      user: null,
      type: 'user',
      role: UserRole.COUNSELOR,
      room,
      provider: AudioChatProvider.MICROPHONE,
      chatId: -99,
      tenantId: 'default',
    };

    this.connectedUsers.add(+userId);

    this.logger.info(
      `Client ${client.id} authenticated and joined room ${room}`,
    );
  }

  @SubscribeMessage(ChatEvents.START_AUDIO_CHAT)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async startAudioChat(client: Socket, data: any) {
    this.logger.info(`Client ${client.id} sent message: ${data}`);

    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(`❌ Session not found for client ${client.id}`);
      return;
    }

    const chat = await this.chatService.createChatForAnyonymousClient({
      counselorId: session.userId,
      provider: AudioChatProvider.MICROPHONE,
    });

    if (!chat) {
      this.logger.error(`❌ Failed to create chat for client ${client.id}`);
      client.disconnect();
      return;
    }

    const chatId = chat.chatId;

    const updatedSession = {
      ...session,
      chatId,
      tenantId: chat.tenantId,
    };

    this.sessions[client.id] = updatedSession;

    this.logger.info(
      `Chat create for user ${session.userId} with chatId ${chat.chatId}`,
    );

    this.setAuthContext(updatedSession);
    await this.transcriptionService
      .startLiveTranscription(
        updatedSession,
        chatId,
        this.multiSpeakerAudioService.handleDeepgramTranscript.bind(
          this.multiSpeakerAudioService,
        ),
        { diarize: true },
      )
      .catch((error) => {
        this.logger.error(
          `Error starting live transcription for chatId ${chatId}:`,
          error,
        );
      });

    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
      participants: [updatedSession.userId],
      message: {
        userId: updatedSession.userId,
        chatId,
        content: 'User joined audio chat',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.USER_JOINED,
      },
    });
  }

  @SubscribeMessage(ChatEvents.AUDIO_MESSAGE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioMessage(
    client: Socket,
    { chatId, audioData }: { chatId: number; audioData: string },
  ) {
    const isChatPaused = await this.chatService.isChatPaused(chatId);
    if (isChatPaused) {
      this.logger.info(`Chat is paused for chatId ${chatId}`);
      return;
    }
    try {
      const session = this.sessions[client.id];
      if (!session) {
        this.logger.error(`Session not found for client ${client.id}`);
        return;
      }
      //! Need to set the auth context before persisting and broadcasting the message
      this.setAuthContext(session);
      const audioDataBuffer = Buffer.from(audioData, 'base64');
      this.transcriptionService
        .sendAudio(session, audioDataBuffer)
        .catch((error) => {
          this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
        });
    } catch (error) {
      this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
    }
  }

  @SubscribeMessage(ChatEvents.AUDIO_CHAT_PAUSED)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioChatPaused(client: Socket, { chatId }: { chatId: number }) {
    this.logger.info(`Audio chat nudge paused for chatId ${chatId}`);
    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(`Session not found for client ${client.id}`);
      return;
    }
    this.setAuthContext(session);
    await this.chatService.pauseOrResumeChat(chatId, true);
  }

  @SubscribeMessage(ChatEvents.AUDIO_CHAT_RESUMED)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioChatResumed(client: Socket, { chatId }: { chatId: number }) {
    this.logger.info(`Audio chat Nudge resumed for chatId ${chatId}`);
    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(`Session not found for client ${client.id}`);
      return;
    }
    this.setAuthContext(session);
    await this.chatService.pauseOrResumeChat(chatId, false);
  }

  subscribeToMicrophoneChatMessage() {
    this.publisher.subscribe(
      MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
      (data) => {
        this.sendMessageToParticipant(
          data.participants,
          data.message,
          data.broadCastOptions,
        );
      },
    );
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
