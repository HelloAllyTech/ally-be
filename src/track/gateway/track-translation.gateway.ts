import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { TrackTranslationNotificationService } from '../service/track-translation-notification.service';
import {
  TrackTranslationEvents,
  TrackTranslationProgressPayload,
} from '../type/track-translation.type';

const userRoom = (userId: number) => `user:${userId}`;

/**
 * Live progress for course translation runs. Translating a whole course is
 * tens of LLM calls across several languages, so the trainer watches it here
 * rather than polling. Gated on EDIT_ADMIN_TRACK — the same permission that
 * authorises requesting the run.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/tracks/translations',
})
@Injectable()
export class TrackTranslationGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    TrackTranslationGateway.name,
  );

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly trackTranslationNotificationService: TrackTranslationNotificationService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.EDIT_ADMIN_TRACK,
      ]),
    );

    this.trackTranslationNotificationService.addListener(
      (userId: number, payload: TrackTranslationProgressPayload) => {
        this.handleProgress(userId, payload);
      },
    );
  }

  onModuleDestroy() {
    this.trackTranslationNotificationService.removeListener();
  }

  async handleConnection(client: any) {
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }

    client.emit(TrackTranslationEvents.CONNECTED, {
      userId: user.id,
      message: 'Connected to track translation socket',
    });

    client.on('connect_error', (err: any) => {
      this.logger.error(
        `Connection error for client ${client.id} with error ${err.message}`,
      );
    });
  }

  handleDisconnect(client: any) {
    this.logger.info(
      `Client disconnected from track translation socket: ${client.id}`,
    );
  }

  @SubscribeMessage(TrackTranslationEvents.JOIN_USER_TRACK_TRANSLATIONS_ROOM)
  async handleJoinRoom(client: any) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }
    const room = userRoom(user.id);
    await client.join(room);
    this.logger.info(
      `Client ${client.id} joined track translations room: ${room}`,
    );
  }

  private handleProgress(
    userId: number,
    payload: TrackTranslationProgressPayload,
  ): void {
    try {
      this.server
        .to(userRoom(userId))
        .emit(TrackTranslationEvents.TRANSLATION_PROGRESS, payload);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast track translation progress to user ${userId}: ${error.message}`,
      );
    }
  }
}
