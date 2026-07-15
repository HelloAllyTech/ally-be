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
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';
import { RehearsalNotificationService } from '../service/rehearsal-notification.service';
import { RehearsalService } from '../service/rehearsal.service';
import {
  RehearsalEvents,
  RehearsalRoomTypes,
} from '../enum/rehearsal-status.enum';

interface RehearsalSessionData {
  userId: number;
  clientId: string;
  roomType: RehearsalRoomTypes;
  rehearsalId?: string;
  lookbackMinutes?: number;
}

const userRoom = (userId: number) => `user:${userId}`;
const rehearsalRoom = (rehearsalId: string) => `rehearsal:${rehearsalId}`;

/**
 * Live rehearsal progress for the studio (clone of ScenarioReportGateway):
 * clients join their user room (all their rehearsals) or a single rehearsal
 * room; every RehearsalService notify pushes a fresh snapshot.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/roleplay-studio/rehearsals',
})
@Injectable()
export class RehearsalGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(RehearsalGateway.name);

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly rehearsalNotificationService: RehearsalNotificationService,
    private readonly rehearsalService: RehearsalService,
  ) {}

  private sessions: Map<string, RehearsalSessionData> = new Map();

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS,
      ]),
    );

    this.rehearsalNotificationService.addListener(
      (userId: number, rehearsalId: string) => {
        this.handleRehearsalUpdated(userId, rehearsalId);
      },
    );
  }

  onModuleDestroy() {
    this.rehearsalNotificationService.removeListener();
  }

  async handleConnection(client: any) {
    this.logger.info(`Client connected to rehearsal socket: ${client.id}`);
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }

    client.emit(RehearsalEvents.CONNECTED, {
      userId: user.id,
      message: 'Connected to rehearsal socket',
    });

    client.on('connect_error', (err: any) => {
      this.logger.error(
        `Connection error for client ${client.id} with error ${err.message}`,
      );
    });
  }

  handleDisconnect(client: any) {
    this.logger.info(`Client disconnected from rehearsal socket: ${client.id}`);
    this.sessions.delete(client.id);
  }

  @SubscribeMessage(RehearsalEvents.JOIN_USER_REHEARSALS_ROOM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinUserRehearsalsRoom(
    client: any,
    { lookbackMinutes }: { lookbackMinutes?: number },
  ) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    const room = userRoom(user.id);
    await client.join(room);
    this.sessions.set(client.id, {
      userId: user.id,
      clientId: client.id,
      roomType: RehearsalRoomTypes.USER,
      lookbackMinutes,
    });
    this.logger.info(`Client ${client.id} joined user room: ${room}`);

    try {
      const rehearsals = await this.rehearsalService.getRecentRehearsalsForUser(
        user.id,
        lookbackMinutes,
      );
      client.emit(RehearsalEvents.REHEARSALS_UPDATED, rehearsals);
    } catch (error) {
      this.logger.error(
        `Failed to send initial rehearsals to client ${client.id}: ${error.message}`,
      );
    }
  }

  @SubscribeMessage(RehearsalEvents.JOIN_REHEARSAL_ROOM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinRehearsalRoom(
    client: any,
    { rehearsalId }: { rehearsalId: string },
  ) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    const room = rehearsalRoom(rehearsalId);
    await client.join(room);
    this.sessions.set(client.id, {
      userId: user.id,
      clientId: client.id,
      roomType: RehearsalRoomTypes.REHEARSAL,
      rehearsalId,
    });
    this.logger.info(`Client ${client.id} joined rehearsal room: ${room}`);

    try {
      const rehearsal = await this.rehearsalService.getRehearsal(rehearsalId);
      client.emit(RehearsalEvents.REHEARSALS_UPDATED, rehearsal);
    } catch (error) {
      this.logger.error(
        `Failed to send initial rehearsal to client ${client.id}: ${error.message}`,
      );
    }
  }

  private async handleRehearsalUpdated(
    userId: number,
    rehearsalId: string,
  ): Promise<void> {
    // User room: push the creator's fresh rehearsal list.
    try {
      const userSession = [...this.sessions.values()].find(
        (session) =>
          session.roomType === RehearsalRoomTypes.USER &&
          session.userId === userId,
      );
      if (userSession) {
        const rehearsals =
          await this.rehearsalService.getRecentRehearsalsForUser(
            userId,
            userSession.lookbackMinutes,
          );
        this.server
          .to(userRoom(userId))
          .emit(RehearsalEvents.REHEARSALS_UPDATED, rehearsals);
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish rehearsals to user room for userId ${userId}: ${error.message}`,
      );
    }

    // Rehearsal room: push the single-run snapshot.
    try {
      const hasSubscribers = [...this.sessions.values()].some(
        (session) =>
          session.roomType === RehearsalRoomTypes.REHEARSAL &&
          session.rehearsalId === rehearsalId,
      );
      if (hasSubscribers) {
        const rehearsal = await this.rehearsalService.getRehearsal(rehearsalId);
        this.server
          .to(rehearsalRoom(rehearsalId))
          .emit(RehearsalEvents.REHEARSALS_UPDATED, rehearsal);
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish rehearsal update for ${rehearsalId}: ${error.message}`,
      );
    }
  }
}
