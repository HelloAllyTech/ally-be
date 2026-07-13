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
import { ImprovementNotificationService } from '../service/improvement-notification.service';
import { ImprovementOrchestratorService } from '../service/improvement-orchestrator.service';
import {
  ImprovementEvents,
  ImprovementRoomTypes,
} from '../enum/improvement-run.enum';

interface ImprovementSessionData {
  userId: number;
  clientId: string;
  roomType: ImprovementRoomTypes;
  improvementRunId?: string;
  specId?: string;
}

const userRoom = (userId: number) => `user:${userId}`;
const improvementRoom = (improvementRunId: string) =>
  `improvement:${improvementRunId}`;

/**
 * Live auto-improve progress for the studio (clone of RehearsalGateway):
 * clients join their user room (per-spec run list) or a single run's room;
 * every orchestrator state change pushes a fresh run-detail snapshot.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/roleplay-studio/improvements',
})
@Injectable()
export class ImprovementGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(ImprovementGateway.name);

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly improvementNotificationService: ImprovementNotificationService,
    private readonly improvementOrchestratorService: ImprovementOrchestratorService,
  ) {}

  private sessions: Map<string, ImprovementSessionData> = new Map();

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.VIEW_ROLEPLAY_REHEARSALS,
      ]),
    );

    this.improvementNotificationService.addListener(
      (userId: number, improvementRunId: string) => {
        void this.handleImprovementUpdated(userId, improvementRunId);
      },
    );
  }

  onModuleDestroy() {
    this.improvementNotificationService.removeListener();
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
    client.emit(ImprovementEvents.CONNECTED, {
      userId: user.id,
      message: 'Connected to improvement socket',
    });
  }

  handleDisconnect(client: any) {
    this.sessions.delete(client.id);
  }

  @SubscribeMessage(ImprovementEvents.JOIN_USER_IMPROVEMENTS_ROOM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinUserImprovementsRoom(
    client: any,
    { specId }: { specId?: string },
  ) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }
    await client.join(userRoom(user.id));
    this.sessions.set(client.id, {
      userId: user.id,
      clientId: client.id,
      roomType: ImprovementRoomTypes.USER,
      specId,
    });

    if (specId) {
      try {
        const runs = await this.improvementOrchestratorService.listRuns(specId);
        client.emit(ImprovementEvents.IMPROVEMENTS_UPDATED, runs);
      } catch (error) {
        this.logger.error(
          `Failed to send initial improvement runs to ${client.id}: ${error.message}`,
        );
      }
    }
  }

  @SubscribeMessage(ImprovementEvents.JOIN_IMPROVEMENT_ROOM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinImprovementRoom(
    client: any,
    { improvementRunId }: { improvementRunId: string },
  ) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }
    await client.join(improvementRoom(improvementRunId));
    this.sessions.set(client.id, {
      userId: user.id,
      clientId: client.id,
      roomType: ImprovementRoomTypes.IMPROVEMENT,
      improvementRunId,
    });

    try {
      const detail =
        await this.improvementOrchestratorService.getRunDetail(
          improvementRunId,
        );
      client.emit(ImprovementEvents.IMPROVEMENTS_UPDATED, detail);
    } catch (error) {
      this.logger.error(
        `Failed to send initial improvement detail to ${client.id}: ${error.message}`,
      );
    }
  }

  private async handleImprovementUpdated(
    userId: number,
    improvementRunId: string,
  ): Promise<void> {
    // Run room: full detail snapshot.
    try {
      const hasSubscribers = [...this.sessions.values()].some(
        (session) =>
          session.roomType === ImprovementRoomTypes.IMPROVEMENT &&
          session.improvementRunId === improvementRunId,
      );
      if (hasSubscribers) {
        const detail =
          await this.improvementOrchestratorService.getRunDetail(
            improvementRunId,
          );
        this.server
          .to(improvementRoom(improvementRunId))
          .emit(ImprovementEvents.IMPROVEMENTS_UPDATED, detail);
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish improvement detail for ${improvementRunId}: ${error.message}`,
      );
    }

    // User room: refreshed per-spec run list.
    try {
      const userSession = [...this.sessions.values()].find(
        (session) =>
          session.roomType === ImprovementRoomTypes.USER &&
          session.userId === userId &&
          session.specId,
      );
      if (userSession?.specId) {
        const runs = await this.improvementOrchestratorService.listRuns(
          userSession.specId,
        );
        this.server
          .to(userRoom(userId))
          .emit(ImprovementEvents.IMPROVEMENTS_UPDATED, runs);
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish improvement list for user ${userId}: ${error.message}`,
      );
    }
  }
}
