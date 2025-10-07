import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../logger/logger.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
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
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';
import { Message } from '../../common/entities/message.entity';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/config.service';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/auth/service/permission-validator.service';
import { User } from 'src/common/entities/user.entity';

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
    private jwtService: JwtService,
    private configService: AppConfigService,
    private broadcastMessageService: BroadcastMessageService,
    private permissionValidator: PermissionValidator,
  ) {}

  @WebSocketServer() server!: Server;

  async handleConnection(client: Socket) {
    this.logger.info(`Client connected to cloud telephony chat: ${client.id}`);

    this.authenticateClient(client);

    client.on('connect_error', (err) => {
      this.logger.error(
        `❌ Connection error for client ${client.id}: with error ${err.message}`,
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
    this.logger.info(`🔴 Client disconnected: ${client.id}`);
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

  private async authenticateClient(client: Socket) {
    const token = client.handshake.auth?.token;
    if (!token) {
      this.logger.error(`No JWT token provided for client ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.jwt.accessToken.secret,
      });

      const hasAccess = await this.permissionValidator.validatePermissions(
        payload.sub,
        [PERMISSIONS.START_CLOUD_TELEPHONY_CHAT],
      );

      if (hasAccess) {
        throw new UnauthorizedException(
          `User ${payload.sub} does not have access to cloud telephony`,
        );
      }
      const userId = parseInt(payload.sub);

      const user = {
        id: userId,
        username: payload.username,
        role: payload.role,
        tenantId: payload.tenantId,
      };

      const room = `user-${userId}`;
      client.join(room);

      this.sessions[client.id] = {
        id: client.id,
        userId: +userId,
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
    } catch (error) {
      this.logger.error(
        `JWT verification failed for client ${client.id}:`,
        error,
      );
      client.disconnect();
    }
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
