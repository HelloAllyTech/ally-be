import { Injectable } from '@nestjs/common';
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
import { ScenarioReportNotificationService } from '../service/scenario-report-notification.service';
import { ScenarioReportSessionData } from '../type/scenario-report-session.type';
import {
  ScenarioReportEvents,
  ScenarioReportRoomTypes,
} from '../enum/scenario-report.enum';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';
import { ScenarioReportService } from '../service/scenario-report.service';

const userRoom = (userId: number) => `user:${userId}`;
const reportRoom = (reportId: string) => `report:${reportId}`;

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/scenarios/reports',
})
@Injectable()
export class ScenarioReportGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = LoggerService.getInstance(
    ScenarioReportGateway.name,
  );

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly scenarioReportNotificationService: ScenarioReportNotificationService,
    private readonly scenarioReportService: ScenarioReportService,
  ) {}

  private sessions: Map<string, ScenarioReportSessionData> = new Map();

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.EDIT_SCENARIO_REPORTS,
      ]),
    );

    this.scenarioReportNotificationService.addListener(
      (userId: number, reportId: string) => {
        this.handleReportUpdated(userId, reportId);
      },
    );
  }

  async handleConnection(client: any) {
    this.logger.info(
      `Client connected to scenario report socket: ${client.id}`,
    );
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }

    client.emit(ScenarioReportEvents.CONNECTED, {
      userId: user.id,
      message: 'Connected to scenario report socket',
    });

    client.on('connect_error', (err: any) => {
      this.logger.error(
        `Connection error for client ${client.id} with error ${err.message}`,
      );
    });
  }

  handleDisconnect(client: any) {
    this.logger.info(
      `Client disconnected from scenario report socket: ${client.id}`,
    );
    this.sessions.delete(client.id);
  }

  @SubscribeMessage(ScenarioReportEvents.JOIN_USER_REPORTS_ROOM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinUserReportsRoom(
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
      roomType: ScenarioReportRoomTypes.USER,
      lookbackMinutes,
    });

    this.logger.info(
      `Client ${client.id} joined user room: ${room} | lookbackMinutes: ${lookbackMinutes}`,
    );

    // Send initial snapshot to this client only
    try {
      const reports =
        await this.scenarioReportService.getFilteredScenarioReports(
          user.id,
          lookbackMinutes,
        );
      client.emit(ScenarioReportEvents.REPORTS_UPDATED, reports);
      this.logger.info(
        `Initial user reports sent to client ${client.id} successfully`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send initial user reports to client ${client.id}: ${error.message}`,
      );
    }
  }

  @SubscribeMessage(ScenarioReportEvents.JOIN_SCENARIO_REPORT_ROOM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinReportRoom(client: any, { reportId }: { reportId: string }) {
    const user = client.data.user;
    if (!user) {
      client.disconnect();
      return;
    }

    const room = reportRoom(reportId);
    await client.join(room);

    this.sessions.set(client.id, {
      userId: user.id,
      clientId: client.id,
      roomType: ScenarioReportRoomTypes.REPORT,
      reportId,
    });

    this.logger.info(`Client ${client.id} joined report room: ${room}`);

    // Send initial snapshot to this client only
    try {
      const report =
        await this.scenarioReportService.getScenarioReportById(reportId);
      client.emit(ScenarioReportEvents.REPORTS_UPDATED, report);
      this.logger.info(
        `Initial report data sent to client ${client.id} successfully`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send initial report data to client ${client.id}: ${error.message}`,
      );
    }
  }

  private async handleReportUpdated(
    userId: number,
    reportId: string,
  ): Promise<void> {
    // Broadcast to user room
    try {
      const userSession = [...this.sessions.values()].find(
        (session) =>
          session.roomType === ScenarioReportRoomTypes.USER &&
          session.userId === userId,
      );

      if (userSession) {
        const reports =
          await this.scenarioReportService.getFilteredScenarioReports(
            userId,
            userSession.lookbackMinutes,
          );
        this.server
          .to(userRoom(userId))
          .emit(ScenarioReportEvents.REPORTS_UPDATED, reports);

        this.logger.info(
          `Scenario reports updated and sent to user room ${userRoom(userId)} successfully`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish scenario reports to user room for userId ${userId}: ${error.message}`,
      );
    }

    // Broadcast to report room
    try {
      const hasReportSubscribers = [...this.sessions.values()].some(
        (session) =>
          session.roomType === ScenarioReportRoomTypes.REPORT &&
          session.reportId === reportId,
      );

      if (hasReportSubscribers) {
        const report =
          await this.scenarioReportService.getScenarioReportById(reportId);
        this.server
          .to(reportRoom(reportId))
          .emit(ScenarioReportEvents.REPORTS_UPDATED, report);

        this.logger.info(
          `Scenario report updated and sent to report room ${reportRoom(reportId)} successfully`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to publish scenario report update to report room for reportId ${reportId}: ${error.message}`,
      );
    }
  }
}
