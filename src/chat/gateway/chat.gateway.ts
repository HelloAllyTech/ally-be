import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../logger/logger.service';
import { UserService } from '../../user/user.service';
import {
  DeepgramTranscriptMetadata,
  MessagePayload,
  NudgeResponse,
  SendMessageWebSocketData,
  ServiceSessionData,
  UserChatSessionData,
} from '../type/chat.type';
import { ChatEvents } from '../constants/chat.constants';
import { ChatService } from '../services/chat.service';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { AiService } from '../../ai/service/ai.service';
import { Message, MessageType } from '../../common/entities/message.entity';
import { AppConfigService } from '../../config/config.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { TranscriptionService } from '../../ai/service/transcription.service';
import { Chat } from '../../common/entities/chat.entity';

@WebSocketGateway({
  cors: { origin: '*' },
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private sessions: { [key: string]: UserChatSessionData } = {};
  private serverSessions: { [key: string]: ServiceSessionData } = {};
  private connectedUsers = new Set<number>();

  constructor(
    private userService: UserService,
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
    private aiService: AiService,
    private transcriptionService: TranscriptionService,
    private config: AppConfigService,
    private publisher: MessageBrokerService,
  ) {}

  logger = LoggerService.getInstance(ChatGateway.name);

  @WebSocketServer() server!: Server;

  private async authenticateClient(client: Socket) {
    const auth = client.handshake.auth;
    if (!auth) {
      this.logger.error(`No auth data for client ${client.id}`);
      client.disconnect();
      return;
    }

    if (auth.type === 'service') {
      this.authenticateService(client, auth);
    } else {
      await this.authenticateUser(client, auth);
    }
  }

  private authenticateService(client: Socket, auth: any) {
    const serviceId = auth.serviceId;
    if (!serviceId) {
      this.logger.error(`Missing serviceId for client ${client.id}`);
      client.disconnect();
      return;
    }

    const service = {
      id: serviceId,
      name: auth.serviceName,
      role: auth.role,
    };

    const room = `service-${service.id}`;
    this.serverSessions[service.id] = {
      id: service.id,
      serviceId,
      service,
      room,
      type: 'service',
    };

    client.join(room);
    this.logger.info(`Service ${serviceId} joined room: ${room}`);
  }

  private async authenticateUser(client: Socket, auth: any) {
    const userId = auth?.user?.userId;
    if (!userId) {
      this.logger.error(` Missing userId for client ${client.id}`);
      client.disconnect();
      return;
    }

    const user = await this.userService.get(userId);
    if (!user) {
      this.logger.error(`User not found for client ${client.id}`);
      client.disconnect();
      return;
    }

    const room = `user-${userId || client.id}`;
    this.sessions[client.id] = {
      id: client.id,
      userId: user.id,
      user,
      type: 'user',
      role: user.role,
      room,
      chatId: -99,
    };

    client.join(room);
    this.connectedUsers.add(+userId);
    this.logger.info(`✅ User ${userId} joined room: ${room}`);
  }

  async handleConnection(client: Socket) {
    this.logger.info(`Client connected: ${client.id}`);
    await this.authenticateClient(client);

    client.on('connect_error', (err) => {
      this.logger.error(
        `❌ Connection error for client ${client.id}:`,
        err.message,
      );
    });

    client.on('disconnect', (reason) => {
      this.logger.info(
        `🔴 Client disconnected: ${client.id}, reason: ${reason}`,
      );
      this.handleDisconnect(client);
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.info(`🔴 Client disconnected: ${client.id}`);
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }
    this.connectedUsers.delete(+session.userId);
    this.transcriptionService.stopLiveTranscription(session);
  }

  @SubscribeMessage(ChatEvents.SEND_MESSAGE)
  async handleSendMessage(client: Socket, data: SendMessageWebSocketData) {
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }
    const message = await this.persistAndBroadcastMessage(session, data);
    this.logger.info(`🔄 Triggering nudge for chatId: ${data.chatId}`);
    this.triggerNudge(message, session, data.chatId);
  }

  private async prepareMessage(
    session: UserChatSessionData,
    data: SendMessageWebSocketData,
    broadCastOptions: {
      event?: ChatEvents;
    },
  ) {
    const chatId = data.chatId;
    const senderId = session.userId;
    const chat = await this.chatService.getChatById(chatId);
    const message = await this.chatService.getMessageObject(
      chatId,
      senderId,
      data,
    );
    if (!chat) {
      this.logger.error(`Chat not found for chatId: ${chatId}`);
      return;
    }
    const participants = [chat?.counselorId!];
    if (
      broadCastOptions.event != ChatEvents.NUDGE &&
      broadCastOptions.event != ChatEvents.STAGE
    ) {
      participants.push(chat?.clientId!);
    }
    return {
      participants,
      message,
      broadCastOptions,
    };
  }

  private async persistAndBroadcastMessage(
    session: UserChatSessionData,
    data: SendMessageWebSocketData,
    broadCastOptions: {
      event?: ChatEvents;
    } = {
      event: ChatEvents.MESSAGE_RECEIVED,
    },
  ) {
    const chatId = data.chatId;
    const senderId = session.userId;
    const message = await this.chatService.saveMessage(chatId, senderId, data);
    const chat = await this.chatService.getChatById(chatId);
    const participants = [chat?.counselorId!];
    if (
      broadCastOptions.event != ChatEvents.NUDGE &&
      broadCastOptions.event != ChatEvents.STAGE
    ) {
      participants.push(chat?.clientId!);
    }

    this.publisher.publish('chat-message', {
      participants,
      message,
      broadCastOptions,
    });
    return message;
  }

  // **Audio Chat Handling**
  @SubscribeMessage(ChatEvents.START_AUDIO_CHAT)
  startAudioChat(client: Socket, { chatId }: { chatId: number }) {
    try {
      const session = this.sessions[client.id];
      if (!session) {
        this.logger.error(`Session not found for client ${client.id}`);
        return;
      }
      session.chatId = chatId;
      this.transcriptionService
        .startLiveTranscription(
          session,
          chatId,
          this.handleDeepgramTranscript.bind(this),
        )
        .catch((error) => {
          this.logger.error(
            `Error starting live transcription for chatId ${chatId}:`,
            error,
          );
        });

      // TODO: Store audio in backend (S3, database, etc.)
    } catch (error) {
      this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
    }
  }

  // **Audio Chat Handling**
  @SubscribeMessage(ChatEvents.AUDIO_MESSAGE)
  handleAudioMessage(
    client: Socket,
    { chatId, audioData }: { chatId: number; audioData: Buffer },
  ) {
    try {
      const session = this.sessions[client.id];
      if (!session) {
        this.logger.error(`Session not found for client ${client.id}`);
        return;
      }

      this.transcriptionService.sendAudio(session, audioData).catch((error) => {
        this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
      });
    } catch (error) {
      this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
    }
  }

  @SubscribeMessage(ChatEvents.AUDIO_CHAT_MUTED)
  async handleAudioChatMuted(client: Socket, { chatId }: { chatId: number }) {
    try {
      this.logger.info(
        `🎤 handleAudioChatMuted  chatId ${chatId} from ${client.id}`,
      );
      const session = this.sessions[client.id];
      if (!session) {
        this.logger.error(`Session not found for client ${client.id}`);
        return;
      }

      await this.transcriptionService.handleAudioChatMuted(session);
    } catch (error) {
      this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
    }
  }

  @SubscribeMessage(ChatEvents.WEBRTC_OFFER)
  handleOffer(client: Socket, data: any) {
    this.logger.info(`WebRTC Offer from ${client.id}`);
    return this.sendWebRTCMessage(client, data, ChatEvents.WEBRTC_OFFER);
  }

  @SubscribeMessage(ChatEvents.WEBRTC_ANSWER)
  handleAnswer(client: Socket, data: any) {
    this.logger.info(`WebRTC Answer from ${client.id} `);
    return this.sendWebRTCMessage(client, data, ChatEvents.WEBRTC_ANSWER);
  }

  @SubscribeMessage(ChatEvents.ICE_CANDIDATE)
  handleIceCandidate(client: Socket, data: any) {
    return this.sendWebRTCMessage(client, data, ChatEvents.ICE_CANDIDATE);
  }

  /**WebRTC Message Handling**
   * send WebRTC message to the other participant in the chat
   **/

  async sendWebRTCMessage(client: Socket, data: any, event: string) {
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }

    const chatId = data.chatId;
    const senderId = session.userId;
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      this.logger.error(`Chat not found for chatId: ${chatId}`);
      client.emit('error', 'Chat not found');
      return;
    }
    const clientId = chat.clientId;
    const counselorId = chat.counselorId;
    const target = `user-${senderId === clientId ? counselorId : clientId}`;
    this.server.to(target).emit(event, data);
  }

  private async triggerNudge(
    newMessage: { content: string; chatId: number; id: number },
    session: UserChatSessionData,
    chatId: number,
  ) {
    const messages = await this.chatService.getChatHistoryForAIService(chatId, {
      sortBy: 'createdAt',
      order: 'DESC',
      limit: 4,
    });
    const formattedNewMessage = `${session.role}: ${newMessage.content}`;

    this.aiService
      .getNudge(formattedNewMessage, messages)
      .then((nudge) => {
        this.logger.info(
          `Nudge:${newMessage.content} | chatId :${chatId} | ${nudge?.nudge} | stage: ${nudge?.stage}`,
        );
        if (nudge) {
          this.handleNudge(nudge, session, newMessage);
        }
      })
      .catch((error) => {
        this.logger.error(
          `AI Nudge Error: ${error.message} | chatId : ${chatId} | userId : ${session.userId}`,
        );
      });
  }

  private async handleNudge(
    nudgeResponse: NudgeResponse,
    session: UserChatSessionData,
    parentMessage: { content: string; chatId: number; id: number },
  ) {
    this.logger.info(
      `handleNudge - nudge :${nudgeResponse.nudge} | stage :${nudgeResponse.stage}`,
    );
    const { nudge, stage } = nudgeResponse;
    if (nudge) {
      await this.persistAndBroadcastMessage(
        session,
        {
          chatId: parentMessage.chatId,
          content: nudge,
          messageType: MessageType.NUDGE,
          parentMessageId: parentMessage.id,
        },
        {
          event: ChatEvents.NUDGE,
        },
      );
    }
    if (stage) {
      await this.persistAndBroadcastMessage(
        session,
        {
          chatId: parentMessage.chatId,
          content: stage,
          messageType: MessageType.STAGE,
          parentMessageId: parentMessage.id,
        },
        {
          event: ChatEvents.STAGE,
        },
      );
    }
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

  async handleDeepgramTranscript(
    session: UserChatSessionData,
    chatId: number,
    transcript: string,
    metadata?: DeepgramTranscriptMetadata,
  ): Promise<void> {
    const { isSentenceComplete, currentTranscriptBuffer, isFinal } =
      metadata || {};
    this.logger.info(
      `🎤 Transcription: ${transcript} - ${new Date().toISOString()}`,
    );

    if (!transcript?.trim() && !currentTranscriptBuffer?.trim()) {
      this.logger.error(
        `No transcript or currentTranscriptBuffer found for chatId: ${chatId}`,
      );
      return;
    }

    const messageData = { chatId, content: transcript, context: '' };
    const { participants, message, broadCastOptions } =
      (await this.prepareMessage(session, messageData, {
        event: ChatEvents.MESSAGE_RECEIVED,
      })) || { participants: [], message: {} as Message };
    if (!participants.length || !message) {
      this.logger.error(
        `No participants or message found for chatId: ${chatId}`,
      );
      return;
    }

    this.publisher.publish('chat-message', {
      participants,
      message: {
        ...message,
        isFinal,
        isSentenceComplete,
        currentTranscriptBuffer,
        createdAt: metadata?.currentTranscriptCreatedAt,
      },
      broadCastOptions,
    });

    //this.sendMessageToParticipant(participants, message); // Broadcast the transcript immediately

    if (this.config.ai.sentenceCompletionRequired && isSentenceComplete) {
      const completedMessage = await this.chatService.saveMessage(
        chatId,
        session.userId,
        {
          content: currentTranscriptBuffer || transcript,
          createdAt: metadata?.currentTranscriptCreatedAt,
        },
      );
      this.triggerNudge(completedMessage, session, chatId);
    } else if (!this.config.ai.sentenceCompletionRequired) {
      const savedMessage = await this.chatService.save(message);
      this.triggerNudge(savedMessage, session, chatId);
    }
  }

  sendMessagesToRoom(room: string, payload: MessagePayload) {
    const event = payload.type || ChatEvents.MESSAGE_RECEIVED;
    this.logger.info(
      `Sending message to room: ${room} | event: ${JSON.stringify(event)}`,
    );
    this.server.to(room).emit(event, payload);
  }

  subscribeToChatMessages() {
    this.publisher.subscribe('chat-message', (data) => {
      this.sendMessageToParticipant(
        data.participants,
        data.message,
        data.broadCastOptions,
      );
    });
  }

  broadcastChatEndedEvent(chat: Chat) {
    const chatId = chat.id;
    const participants = [chat.counselorId, chat.clientId];
    const message = {
      chatId,
      content: 'Chat ended',
      messageType: MessageType.SYSTEM,
    };
    this.publisher.publish('chat-message', {
      participants,
      message,
      broadCastOptions: {
        event: ChatEvents.CHAT_ENDED,
      },
    });
  }
}
