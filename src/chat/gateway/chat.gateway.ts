import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../logger/logger.service';
import {
  DeepgramTranscriptMetadata,
  MessagePayload,
  SendMessageWebSocketData,
  UserChatSessionData,
} from '../type/chat.type';
import { ChatEvents } from '../constants/chat.constants';
import { ChatService } from '../service/chat.service';
import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Message, MessageType } from '../../common/entities/message.entity';
import { AppConfigService } from '../../config/config.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { TranscriptionService } from '../../ai/service/transcription.service';
import { Chat } from '../../common/entities/chat.entity';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AudioChatProvider } from '../../common/constants/chat.constants';
import { MessageBrokerChannel } from '../../common/constants/message-broker.constants';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/webrtc-audio-chat',
})
@Injectable()
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private sessions: { [key: string]: UserChatSessionData } = {};
  private connectedUsers = new Set<number>();

  constructor(
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
    private transcriptionService: TranscriptionService,
    private config: AppConfigService,
    private publisher: MessageBrokerService,
    private jwtService: JwtService,
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

    await this.authenticateUser(client, auth);
  }

  private async authenticateUser(client: Socket, auth: any) {
    const token = auth?.token;
    if (!token) {
      this.logger.error(`No JWT token provided for client ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.config.jwt.accessToken.secret,
      });
      const userId = parseInt(payload.sub);

      const user = {
        id: userId,
        username: payload.username,
        role: payload.role,
        tenantId: payload.tenantId,
      };

      const room = `user-${userId || client.id}`;
      this.sessions[client.id] = {
        id: client.id,
        userId: user.id,
        user,
        type: 'user',
        role: user.role,
        room,
        chatId: -99,
        tenantId: user.tenantId,
        provider: AudioChatProvider.WEBRTC,
      };

      client.join(room);
      this.connectedUsers.add(+userId);
      this.logger.info(`User ${userId} joined room: ${room}`);
    } catch (error) {
      this.logger.error(
        `JWT verification failed for client ${client.id}:`,
        error,
      );
      client.disconnect();
    }
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
    const chatId = await this.chatService.getChatById(session.chatId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const participants = [chatId?.counselorId!, chatId?.clientId!].filter(
      (id) => id !== session.userId,
    );

    if (chatId) {
      this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
        participants,
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

  @SubscribeMessage(ChatEvents.SEND_MESSAGE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleSendMessage(client: Socket, data: SendMessageWebSocketData) {
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }
    //! Need to set the auth context before persisting and broadcasting the message
    this.setAuthContext(session);
    const message = await this.chatService.persistAndBroadcastMessage(
      session,
      data,
    );
    this.logger.info(`🔄 Triggering nudge for chatId: ${data.chatId}`);
    this.chatService.triggerNudge(
      message,
      session,
      data.chatId,
      MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
    );
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const participants = [chat?.counselorId!];
    if (
      broadCastOptions.event != ChatEvents.NUDGE &&
      broadCastOptions.event != ChatEvents.STAGE
    ) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
      participants.push(chat?.clientId!);
    }
    return {
      participants,
      message,
      broadCastOptions,
    };
  }

  @SubscribeMessage(ChatEvents.START_AUDIO_CHAT)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async startAudioChat(client: Socket, { chatId }: { chatId: number }) {
    try {
      const session = this.sessions[client.id];
      this.logger.info(`startAudioChat - chatId: ${chatId} from ${client.id}}`);
      if (!session) {
        this.logger.error(`Session not found for client ${client.id}`);
        return;
      }
      //! Need to set the auth context before persisting and broadcasting the message
      this.setAuthContext(session);
      session.chatId = chatId;
      const chat = await this.chatService.getChatById(chatId);
      await this.transcriptionService
        .startLiveTranscription(
          {
            session,
            chatId,
            chatCreatedAt: chat?.createdAt,
          },
          this.handleDeepgramTranscript.bind(this),
        )
        .catch((error) => {
          this.logger.error(
            `Error starting live transcription for chatId ${chatId}:`,
            error,
          );
        });
      if (chat) {
        const participants = [chat.counselorId, chat.clientId].filter(
          (id) => id !== session.userId,
        );
        this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
          participants,
          message: {
            userId: session.userId,
            chatId,
            content: 'User joined audio chat',
            messageType: MessageType.SYSTEM,
          },
          broadCastOptions: {
            event: ChatEvents.USER_JOINED,
          },
        });
      }

      // TODO: Store audio in backend (S3, database, etc.)
    } catch (error) {
      this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
    }
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
      const audioBuffer = Buffer.from(audioData, 'base64');
      this.transcriptionService
        .sendAudio(session, audioBuffer)
        .catch((error) => {
          this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
        });
      //broadcast the audio message
      const chat = await this.chatService.getChatById(chatId);
      if (chat) {
        const participants = [chat.counselorId];
        this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
          participants,
          message: {
            userId: session.userId,
            audioData,
            chatId,
            content: 'Audio message',
          },
          broadCastOptions: {
            event: ChatEvents.AUDIO_STREAM,
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error sending audio to chatId ${chatId}:`, error);
    }
  }

  @SubscribeMessage(ChatEvents.AUDIO_CHAT_MUTED)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
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
      //! Need to set the auth context before persisting and broadcasting the message
      this.setAuthContext(session);

      await this.transcriptionService.handleAudioChatMuted(session);
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

  @SubscribeMessage(ChatEvents.WEBRTC_OFFER)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  handleOffer(client: Socket, data: any) {
    this.logger.info(`WebRTC Offer from ${client.id}`);
    return this.sendWebRTCMessage(client, data, ChatEvents.WEBRTC_OFFER);
  }

  @SubscribeMessage(ChatEvents.WEBRTC_ANSWER)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  handleAnswer(client: Socket, data: any) {
    this.logger.info(`WebRTC Answer from ${client.id} `);
    return this.sendWebRTCMessage(client, data, ChatEvents.WEBRTC_ANSWER);
  }

  @SubscribeMessage(ChatEvents.ICE_CANDIDATE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
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
    //! Need to set the auth context before persisting and broadcasting the message
    this.setAuthContext(session);

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

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleDeepgramTranscript(
    session: UserChatSessionData,
    chatId: number,
    transcript: string,
    metadata?: DeepgramTranscriptMetadata,
  ): Promise<void> {
    this.setAuthContext(session);
    const {
      isSentenceComplete,
      currentTranscriptBuffer,
      isFinal,
      isUtteranceEnd,
      wordCountByLanguage,
    } = metadata || {};
    this.logger.info(
      `🎤 Transcription: ${transcript} - ${new Date().toISOString()}`,
    );

    if (isUtteranceEnd) {
      await this.handleUtteranceEnd(session, chatId, transcript, metadata);
      return;
    }

    if (!transcript?.trim() && !currentTranscriptBuffer?.trim()) {
      this.logger.error(
        `No transcript or currentTranscriptBuffer found for chatId: ${chatId}`,
      );
      return;
    }

    if (Object.keys(wordCountByLanguage || {}).length) {
      Object.entries(wordCountByLanguage || {}).forEach(([language, count]) => {
        this.chatService.incrementWordCountByLanguage(chatId, language, count);
      });
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

    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
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
          startSeconds: metadata?.currentTranscriptStart,
          endSeconds: metadata?.currentTranscriptEnd,
        },
      );
      this.chatService.triggerNudge(
        completedMessage,
        session,
        chatId,
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      );
    } else if (!this.config.ai.sentenceCompletionRequired) {
      const savedMessage = await this.chatService.save(message);
      this.chatService.triggerNudge(
        savedMessage,
        session,
        chatId,
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      );
    }
  }

  private async handleUtteranceEnd(
    session: UserChatSessionData,
    chatId: number,
    transcript: string,
    metadata?: DeepgramTranscriptMetadata,
  ): Promise<void> {
    const { currentTranscriptBuffer } = metadata || {};
    this.logger.info(
      `🎤 Utterance end for userId: ${session.userId} | currentUtterance: ${currentTranscriptBuffer}`,
    );

    const messageData = { chatId, content: 'Speaker stopped', context: '' };
    const { participants, message, broadCastOptions } =
      (await this.prepareMessage(session, messageData, {
        event: ChatEvents.UTTERANCE_ENDED,
      })) || { participants: [], message: {} as Message };
    if (!participants.length || !message) {
      this.logger.error(
        `No participants or message found for chatId: ${chatId}`,
      );
      return;
    }

    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
      participants,
      message: {
        ...message,
      },
      broadCastOptions,
    });

    if (currentTranscriptBuffer?.trim()) {
      const completedMessage = await this.chatService.saveMessage(
        chatId,
        session.userId,
        {
          content: currentTranscriptBuffer || transcript,
          createdAt: metadata?.currentTranscriptCreatedAt,
          startSeconds: metadata?.currentTranscriptStart,
          endSeconds: metadata?.currentTranscriptEnd,
        },
      );
      this.chatService.triggerNudge(
        completedMessage,
        session,
        chatId,
        MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      );
    }
  }

  sendMessagesToRoom(room: string, payload: MessagePayload) {
    const event = payload.type || ChatEvents.MESSAGE_RECEIVED;
    this.logger.info(
      `Sending message to room: ${room} | event: ${JSON.stringify(event)}`,
    );
    this.server.to(room).emit(event, payload);
  }

  subscribeToWebRTCChatMessage() {
    this.publisher.subscribe(
      MessageBrokerChannel.CHAT_MESSAGE_WEBRTC,
      (data) => {
        this.sendMessageToParticipant(
          data.participants,
          data.message,
          data.broadCastOptions,
        );
      },
    );
  }

  sendMessagesToRoomUsingPublish(
    event: ChatEvents,
    participantIds: number[],
    message?: any,
  ) {
    this.logger.info(
      `Sending message to participants: ${JSON.stringify(participantIds)} | event: ${JSON.stringify(event)}`,
    );
    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
      participants: participantIds,
      message,
      broadCastOptions: {
        event,
      },
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
    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_WEBRTC, {
      participants,
      message,
      broadCastOptions: {
        event: ChatEvents.CHAT_ENDED,
      },
    });
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.role,
      session.tenantId,
    );
  }
}
