import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../logger/logger.service';
import { UserService } from '../user/user.service';
import {
  MessagePayload,
  ServiceSessionData,
  UserChatSessionData,
} from './type/chat.type';
import { ChatEvents } from './constants/chat.constants';
import { ChatService } from './chat.service';
import { forwardRef, Inject } from '@nestjs/common';
import { MessageType } from '../common/entities/message.entity';
import { AiService } from '../ai/ai.service';

@WebSocketGateway({
  cors: { origin: '*' },
  //  namespace: 'chat', // Ensure client connects to this namespace
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private sessions: { [key: string]: UserChatSessionData } = {};
  private serverSessions: { [key: string]: ServiceSessionData } = {};

  constructor(
    private userService: UserService,
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
    private aiService: AiService,
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
      serviceId,
      service,
      room,
      type: 'service',
    };

    client.join(room);
    this.logger.info(`Service ${serviceId} joined room: ${room}`);
  }

  private async authenticateUser(client: Socket, auth: any) {
    const userId = auth?.user?.user_id;
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
      userId: user.id,
      user,
      type: 'user',
      role: user.role,
      room,
    };

    client.join(room);
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
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.info(`🔴 Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(client: Socket, room: string) {
    try {
      client.leave(room);
      this.logger.info(`🚪 Client ${client.id} left room: ${room}`);
      client.emit('leftRoom', `You left room: ${room}`);
    } catch (error) {
      this.logger.error(
        `❌ Error leaving room ${room} for client ${client.id}:`,
        error,
      );
    }
  }

  @SubscribeMessage('roomMessage')
  handleRoomMessage(
    client: Socket,
    { room, message }: { room: string; message: string },
  ) {
    try {
      this.logger.info(
        `📨 Message to room ${room} from ${client.id}: ${message}`,
      );
      this.server
        .to(room)
        .emit('roomMessage', { clientId: client.id, message });
    } catch (error) {
      this.logger.error(`❌ Error sending message to room ${room}:`, error);
    }
  }

  @SubscribeMessage(ChatEvents.SEND_MESSAGE)
  async handleSendMessage(client: Socket, data: any) {
    const sid = client.id;
    const session = this.sessions[sid];
    if (!session) {
      this.logger.error(`Session not found for client ${sid}`);
      return;
    }

    const chatId = data.chat_id;
    const senderId = session.userId;
    const message = await this.chatService.saveMessage(chatId, senderId, data);
    const formattedMessage = this.chatService.formatMessage(message);
    const chat = await this.chatService.getChatById(chatId);
    const participants = [chat?.clientId, chat?.counselorId];
    participants.forEach((participant) => {
      const room = `user-${participant}`;
      this.sendMessagesToRoom(room, {
        type: ChatEvents.MESSAGE_RECEIVED,
        payload: formattedMessage,
      });
    });

    const messages = await this.chatService.getMessageByChatId(chatId, {
      type: MessageType.TEXT,
      limit: 4,
    });
    const previousMessage = messages.reduce(
      (acc, cur) => acc + cur.content,
      '\n',
    );
    this.aiService
      .getNudge(message.content, previousMessage)
      .then((nudge) => {
        if (nudge) {
          this.sendMessagesToRoom(session.room, {
            type: ChatEvents.NUDGE,
            payload: nudge,
          });
        }
      })
      .catch((error) => {
        this.logger.error(`AI Nudge Error: ${error.message}`);
      });
  }

  // **Audio Chat Handling**
  @SubscribeMessage('audioMessage')
  handleAudioMessage(
    client: Socket,
    { room, audioData }: { room: string; audioData: Buffer },
  ) {
    try {
      this.logger.info(`🎤 Audio message to room ${room} from ${client.id}`);
      //const session = this.sessions[client.id];
      // writeFileSync(`audio-${session?.userId}-${Date.now()}.wav`, audioData);
      // this.server
      //   .to(room)
      //   .emit('audioMessage', { clientId: client.id, audioData });

      // TODO: Store audio in backend (S3, database, etc.)
    } catch (error) {
      this.logger.error(`Error sending audio to room ${room}:`, error);
    }
  }

  sendMessagesToRoom(room: string, payload: MessagePayload) {
    const event = payload.type || ChatEvents.MESSAGE_RECEIVED;
    this.server.to(room).emit(event, payload);
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
    this.logger.info(`ICE Candidate from ${client.id} `);
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

    const chatId = data.chat_id;
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
}
