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
import { ChatService } from '../../chat/service/chat.service';
import {
  PLACEHOLDER_CHAT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { MessagePayload, UserChatSessionData } from '../../chat/type/chat.type';
import { ChatEvents } from '../../chat/constants/chat.constants';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../message-broker/constants/message-broker.constants';
import { Message } from '../../chat/entity/message.entity';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/cloud-telephony-chat',
})
@Injectable()
export class CloudTelephonyGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = LoggerService.getInstance(
    CloudTelephonyGateway.name,
  );

  private sessions: { [key: string]: UserChatSessionData } = {};

  constructor(
    private chatService: ChatService,
    private publisher: MessageBrokerService,
    private broadcastMessageService: BroadcastMessageService,
    private webSocketAuthMiddleware: WebSocketAuthMiddleware,
  ) {}

  @WebSocketServer() server!: Server;
  afterInit(server: Server) {
    this.logger.info('Cloud telephony WS initialized; registering middleware');

    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.START_CLOUD_TELEPHONY_CHAT,
      ]),
    );
  }

  async handleConnection(client: Socket) {
    this.logger.info(`Client connected to cloud telephony chat: ${client.id}`);
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }
    const room = `user-${user.id}`;
    client.join(room);

    this.sessions[client.id] = {
      id: client.id,
      userId: +user.id,
      user: null,
      type: 'user',
      role: UserRole.COUNSELOR,
      room,
      chatId: PLACEHOLDER_CHAT_ID,
      tenantId: user.tenantId,
    };

    this.logger.info(
      `Client ${client.id} authenticated and joined room ${room}`,
    );
    client.on('connect_error', (err) => {
      this.logger.error(
        `Connection error for client ${client.id}: with error ${err.message}`,
      );
    });

    client.on('disconnect', () => {
      this.logger.info(
        `Client disconnected from cloud telephony chat: ${client.id}`,
      );
      this.handleDisconnect(client);
    });
  }

  async handleDisconnect(client: Socket) {
    this.logger.info(`Client disconnected: ${client.id}`);
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }
    this.broadcastMessageService.broadcastUserDisconnectedMessage(
      MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
      {
        participants: [session.userId],
        userId: session.userId,
      },
    );
    delete this.sessions[sid];
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

  @SubscribeMessage(ChatEvents.AUDIO_CHAT_PAUSED)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioChatPaused(client: Socket, { chatId }: { chatId: number }) {
    this.logger.info(`Audio chat nudge paused for chatId ${chatId}`);
    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(
        `Audio chat paused event received but session not found for client ${client.id}`,
      );
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
      this.logger.error(
        `Audio chat resumed event received but session not found for client ${client.id}`,
      );
      return;
    }
    this.setAuthContext(session);
    await this.chatService.pauseOrResumeChat(chatId, false);
  }

  subscribeToCloudTelephonyChatMessage() {
    this.publisher.subscribe(
      MessageBrokerChannel.CHAT_MESSAGE_CLOUD_TELEPHONY,
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
