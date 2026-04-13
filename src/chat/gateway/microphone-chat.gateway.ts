import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../logger/logger.service';
import { Injectable } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import {
  AudioChatPlatform,
  AudioChatProvider,
  ScribeSessionMode,
} from '../../common/constants/chat.constants';
import {
  PLACEHOLDER_CHAT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { MessagePayload, UserChatSessionData } from '../type/chat.type';
import { ChatEvents } from '../constants/chat.constants';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../message-broker/constants/message-broker.constants';
import { Message, MessageType } from '../entity/message.entity';
import { ChatStatus } from '../entity/chat.entity';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/microphone-chat',
})
@Injectable()
export class MicrophoneChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = LoggerService.getInstance(
    MicrophoneChatGateway.name,
  );

  private sessions: { [key: string]: UserChatSessionData } = {};

  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private chatService: ChatService,
    private streamFileProcessorService: StreamFileProcessorService,
    private publisher: MessageBrokerService,
    private broadcastMessageService: BroadcastMessageService,
    private webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private permissionValidator: PermissionValidator,
  ) {}

  @WebSocketServer() server!: Server;

  afterInit(server: Server) {
    this.logger.info(
      'WebSocket server initialized, setting up authentication middleware',
    );

    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.START_MICROPHONE_CHAT,
      ]),
    );
  }

  async handleConnection(client: Socket) {
    this.logger.info(`Client connected to microphone chat: ${client.id}`);
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }
    const room = `user-${user.id}`;
    await client.join(room);
    this.sessions[client.id] = {
      id: client.id,
      userId: user.id,
      user: null,
      type: 'user',
      role: UserRole.COUNSELOR,
      room,
      provider: AudioChatProvider.MICROPHONE,
      chatId: PLACEHOLDER_CHAT_ID,
      tenantId: user.tenantId,
    };

    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
      participants: [user.id],
      message: {
        userId: user.id,
        content: 'User session created',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.SESSION_CREATED,
      },
    });

    this.logger.info(
      `Client ${client.id} authenticated and joined room ${room}`,
    );

    client.on('connect_error', (err) => {
      this.logger.error(
        `Connection error for client co ${client.id} with error ${err.message}`,
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
    this.logger.info(`Client disconnected: ${client.id}`);
    const clientId = client.id;
    const session = this.sessions[clientId];
    if (!session) {
      this.logger.error(`Session not found for client ${clientId}`);
      return;
    }
    // only chat will be ended if valid chatId is provided
    // this will be triggered only from the platform where the chat is started
    if (
      session.chatId !== undefined &&
      session.chatId !== null &&
      session.chatId !== PLACEHOLDER_CHAT_ID
    ) {
      const { tenantId, userId, chatId, provider } = session;
      try {
        await this.chatService.endChat(session.chatId);
        this.auditLogger.log({
          eventType: AUDIT_EVENTS.CALL_ENDED,
          tenantId,
          userId,
          details: {
            chatId,
            provider,
            reason: 'Client disconnected',
          },
        });
      } catch (error) {
        this.logger.error(
          `Failed to end chat for client ${clientId} | session chatId: ${session.chatId} | error: ${error.message}`,
        );
        this.auditLogger.log({
          eventType: AUDIT_EVENTS.CALL_END_FAILED,
          tenantId,
          userId,
          details: {
            chatId,
            reason: error.message,
            clientId,
            provider,
          },
        });
      }
    }
    // Broadcast disconnection
    this.broadcastMessageService.broadcastUserDisconnectedMessage(
      MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
      {
        participants: [session.userId],
        userId: session.userId,
      },
    );
    delete this.sessions[clientId];
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
      const room = `user-${participant}`;
      this.sendMessagesToRoom(room, {
        type: broadCastOptions?.event || ChatEvents.MESSAGE_RECEIVED,
        payload: message,
      });
    });
  }

  private async logErrorAudioCallAuditEvent(
    session: UserChatSessionData,
    chatId: number | null,
    error: string,
  ) {
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.CALL_START_FAILED,
      tenantId: session.tenantId,
      userId: session.userId,
      details: {
        reason: error,
        chatId: chatId?.toString(),
      },
    });
  }

  @SubscribeMessage(ChatEvents.START_AUDIO_CHAT)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async startAudioChat(
    client: Socket,
    {
      isLinear16Encoded,
      platform,
      mode,
      sampleRate,
    }: {
      isLinear16Encoded?: boolean;
      platform: AudioChatPlatform;
      mode?: ScribeSessionMode;
      sampleRate?: number;
    },
  ) {
    this.logger.info(
      `Client ${client.id} start audio chat with isLinear16Encoded: ${isLinear16Encoded} | platform: ${platform} | sampleRate: ${sampleRate}`,
    );

    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(
        `Audio chat start event received but session not found for client ${client.id}`,
      );
      this.logErrorAudioCallAuditEvent(session, null, 'Session not found');
      return;
    }

    this.setAuthContext(session);

    const activeChat = await this.chatService.getChatsByCouncilorId(
      session.userId,
      { status: ChatStatus.ACTIVE },
    );

    if (activeChat) {
      this.logger.error(`User ${session.userId} already has an active chat`);
      this.logErrorAudioCallAuditEvent(
        session,
        activeChat.id,
        'User already has active chat',
      );
      client.disconnect();
      return;
    }
    // Start call stream with chat creation in transaction
    try {
      await this.streamFileProcessorService.startCallStream(
        session,
        {
          counselorId: session.userId,
          provider: AudioChatProvider.MICROPHONE,
          platform,
          mode,
          sampleRate,
        },
        (chatId: number) => {
          // Update session with chatId
          this.sessions[client.id] = {
            ...this.sessions[client.id],
            chatId,
          };

          this.logger.info(
            `Chat created for user ${session.userId} with chatId ${chatId}`,
          );

          this.auditLogger.log({
            eventType: AUDIT_EVENTS.CALL_STARTED,
            tenantId: session.tenantId,
            userId: session.userId,
            details: {
              chatId,
              platform,
              provider: AudioChatProvider.MICROPHONE,
            },
          });
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to start call stream for client ${client.id}:`,
        error,
      );
      client.disconnect();

      this.logErrorAudioCallAuditEvent(session, session.chatId, error.message);
      return;
    }
  }

  @SubscribeMessage(ChatEvents.AUDIO_MESSAGE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioMessage(
    client: Socket,
    { audioData, chatId }: { audioData: string; chatId: number },
  ) {
    if (!this.sessions[client.id]) {
      this.logger.error(
        `Audio message event received but session not found for client ${client.id} | chatId: ${chatId}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          chatId: chatId?.toString(),
          reason: 'Session not found',
          clientId: client.id,
        },
      });
      return;
    }
    if (!chatId) {
      this.logger.error(
        `Audio message event received but chatId is not provided for client ${client.id}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        tenantId: this.sessions[client.id]?.tenantId,
        userId: this.sessions[client.id]?.userId,
        details: {
          reason: 'ChatId not provided',
          clientId: client.id,
        },
      });
      return;
    }
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      this.logger.error(
        `Audio message event received but chat not found for client ${client.id} | chatId: ${chatId}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        tenantId: this.sessions[client.id]?.tenantId,
        userId: this.sessions[client.id]?.userId,
        details: {
          chatId: chatId.toString(),
          reason: 'Chat not found',
          clientId: client.id,
        },
      });
      return;
    }
    this.sessions[client.id] = {
      ...this.sessions[client.id],
      chatId,
    };
    const session = this.sessions[client.id];
    const isChatEnded = await this.chatService.isChatEnded(chatId);
    if (isChatEnded) {
      this.logger.error(
        `Audio message event received but chat is ended for client ${client.id} | chatId: ${chatId}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        tenantId: session.tenantId,
        userId: session.userId,
        details: {
          chatId: chatId.toString(),
          reason: 'Chat already ended',
          clientId: client.id,
        },
      });
      return;
    }
    this.streamFileProcessorService.saveAudio(session, {
      chatId,
      audioBase64: audioData,
      shouldBroadcastAudioMessage: true,
    });
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
      session.tenantId,
    );
  }
}
