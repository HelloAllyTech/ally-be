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
import { ScenarioTranslationNotificationService } from '../service/scenario-translation-notification.service';
import { ScenarioTranslationEvents } from '../enum/scenario-translation.enum';
import { ScenarioTranslationProgressPayload } from '../type/scenario-translation-progress.type';

const userRoom = (userId: number) => `user:${userId}`;

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/scenarios/translations',
})
@Injectable()
export class ScenarioTranslationGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    ScenarioTranslationGateway.name,
  );

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly scenarioTranslationNotificationService: ScenarioTranslationNotificationService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.EDIT_SCENARIO,
      ]),
    );

    this.scenarioTranslationNotificationService.addListener(
      (userId: number, payload: ScenarioTranslationProgressPayload) => {
        this.handleProgress(userId, payload);
      },
    );
  }

  onModuleDestroy() {
    this.scenarioTranslationNotificationService.removeListener();
  }

  async handleConnection(client: any) {
    this.logger.info(
      `Client connected to scenario translation socket: ${client.id}`,
    );
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }

    client.emit(ScenarioTranslationEvents.CONNECTED, {
      userId: user.id,
      message: 'Connected to scenario translation socket',
    });

    client.on('connect_error', (err: any) => {
      this.logger.error(
        `Connection error for client ${client.id} with error ${err.message}`,
      );
    });
  }

  handleDisconnect(client: any) {
    this.logger.info(
      `Client disconnected from scenario translation socket: ${client.id}`,
    );
  }

  @SubscribeMessage(ScenarioTranslationEvents.JOIN_USER_TRANSLATIONS_ROOM)
  async handleJoinUserTranslationsRoom(client: any) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    const room = userRoom(user.id);
    await client.join(room);

    this.logger.info(
      `Client ${client.id} joined user translations room: ${room}`,
    );
  }

  private handleProgress(
    userId: number,
    payload: ScenarioTranslationProgressPayload,
  ): void {
    try {
      this.server
        .to(userRoom(userId))
        .emit(ScenarioTranslationEvents.TRANSLATION_PROGRESS, payload);
    } catch (error) {
      this.logger.error(
        `Failed to broadcast translation progress to user ${userId}: ${error.message}`,
      );
    }
  }
}
