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
import {
  AudioChatPlatform,
  AudioChatProvider,
} from '../../common/constants/chat.constants';
import { UserRole } from 'src/common/constants/user.constants';
import { MessagePayload, UserChatSessionData } from '../type/chat.type';
import { ChatEvents } from '../constants/chat.constants';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { MultiSpeakerAudioService } from '../service/multi-speaker-audio.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';
import { Message, MessageType } from '../../common/entities/message.entity';
import { ChatStatus } from '../../common/entities/chat.entity';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/config.service';

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
    private multiSpeakerAudioService: MultiSpeakerAudioService,
    private publisher: MessageBrokerService,
    private jwtService: JwtService,
    private configService: AppConfigService,
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
    this.multiSpeakerAudioService.broadcastUserDisconnectedMessage(session);
    this.connectedUsers.delete(+session.userId);
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
        provider: AudioChatProvider.MICROPHONE,
        chatId: -99,
        tenantId: user.tenantId,
      };

      this.connectedUsers.add(+userId);

      this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
        participants: [+userId],
        message: {
          userId: +userId,
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
    } catch (error) {
      this.logger.error(
        `JWT verification failed for client ${client.id}:`,
        error,
      );
      client.disconnect();
    }
  }

  @SubscribeMessage(ChatEvents.START_AUDIO_CHAT)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async startAudioChat(
    client: Socket,
    {
      isLinear16Encoded,
      platform,
      activeChatId,
    }: {
      isLinear16Encoded?: boolean;
      platform: AudioChatPlatform;
      activeChatId?: number;
    },
  ) {
    this.logger.info(
      `Client ${client.id} start audio chat with isLinear16Encoded: ${isLinear16Encoded}`,
    );

    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(`❌ Session not found for client ${client.id}`);
      return;
    }

    this.setAuthContext(session);

    // if activeChatId is provided, we are resuming an existing chat
    if (activeChatId) {
      const { chat, callDetails } =
        await this.chatService.getChatWithCallDetails(activeChatId);
      if (
        chat?.status !== ChatStatus.ACTIVE ||
        callDetails?.callInfo?.provider !== AudioChatProvider.MICROPHONE
      ) {
        this.logger.info(
          `Chat ${activeChatId} is not active or provider is not microphone, disconnecting client`,
        );
        this.multiSpeakerAudioService.clearPendingAudioQueue(client.id);
        client.disconnect();
        return;
      }

      // already started call stream for this chat, so we need to update the call stream id
      this.multiSpeakerAudioService.updateCallStreamId(activeChatId, client.id);
      return;
    }

    const activeChat = await this.chatService.getChatsByCouncilorId(
      session.userId,
      { status: ChatStatus.ACTIVE },
    );

    if (activeChat) {
      this.logger.error(`❌ User ${session.userId} already has an active chat`);
      client.disconnect();
      return;
    }

    const chat = await this.chatService.createChatForAnyonymousClient({
      counselorId: session.userId,
      provider: AudioChatProvider.MICROPHONE,
      platform,
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
    };

    this.sessions[client.id] = updatedSession;

    this.logger.info(
      `Chat created for user ${session.userId} with chatId ${chat.chatId}`,
    );

    this.multiSpeakerAudioService.startCallStream(updatedSession);
  }

  @SubscribeMessage(ChatEvents.AUDIO_MESSAGE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioMessage(
    client: Socket,
    { audioData }: { audioData: string },
  ) {
    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(`Session not found for client ${client.id}`);
      return;
    }
    const chatId = session.chatId;
    const isChatPaused =
      session.chatId === -99 // chat is not yet created so we are just saving the audio
        ? false
        : await this.chatService.isChatPaused(chatId);
    if (isChatPaused) {
      this.logger.info(`Chat is paused for chatId ${chatId}`);
      return;
    }
    this.multiSpeakerAudioService.saveAudio(session, audioData);
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

  @SubscribeMessage(ChatEvents.AUDIO_CHAT_ENDED)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioChatEnded(client: Socket) {
    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(`Session not found for client ${client.id}`);
      return;
    }
    this.setAuthContext(session);
    this.multiSpeakerAudioService.endCallStream(session);
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
