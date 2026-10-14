import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { CourseCopilotEventService } from '../service/course-copilot-event.service';
import { CourseCopilotEventView } from '../type/course-copilot-api.type';

const sessionRoom = (sessionId: string) => `course-copilot:${sessionId}`;

export const CourseCopilotSocketEvents = {
  CONNECTED: 'connected',
  JOIN_SESSION: 'joinSession',
  LEAVE_SESSION: 'leaveSession',
  JOINED: 'joined',
  EVENTS: 'copilotEvents',
} as const;

/**
 * Live push for the build panel.
 *
 * A build takes minutes and fills the course item by item; a five-second
 * polling lag makes the pane feel like a log rather than something happening.
 * Pushes only reach clients connected to the process running the build, so
 * the client also polls while a build is running — a socket that never
 * connects, or connects to a different task, degrades the experience without
 * breaking it. Joining a room is not an ownership check: the events carry
 * progress only (job titles, statuses, counts), never course content.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/course-copilot' })
@Injectable()
export class CourseCopilotGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    CourseCopilotGateway.name,
  );

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly eventService: CourseCopilotEventService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.VIEW_COURSE_COPILOT,
      ]),
    );
    this.eventService.addListener((sessionId, events) =>
      this.broadcast(sessionId, events),
    );
  }

  onModuleDestroy() {
    this.eventService.removeListener();
  }

  handleConnection(client: any) {
    const user = client.data?.user;
    if (!user) {
      this.logger.error(
        `No user on authenticated Course Copilot client ${client.id}`,
      );
      client.disconnect();
      return;
    }
    client.emit(CourseCopilotSocketEvents.CONNECTED, { userId: user.id });
  }

  @SubscribeMessage(CourseCopilotSocketEvents.JOIN_SESSION)
  async handleJoinSession(client: any, payload: { sessionId?: string }) {
    const sessionId = payload?.sessionId;
    if (!client.data?.user || !sessionId) return;
    await client.join(sessionRoom(sessionId));
    // Echoed so the client can tell a joined room from a dropped message.
    client.emit(CourseCopilotSocketEvents.JOINED, { sessionId });
  }

  @SubscribeMessage(CourseCopilotSocketEvents.LEAVE_SESSION)
  async handleLeaveSession(client: any, payload: { sessionId?: string }) {
    if (!payload?.sessionId) return;
    await client.leave(sessionRoom(payload.sessionId));
  }

  /** Events carry their seq; the client reconciles, so duplicates cost nothing. */
  private broadcast(sessionId: string, events: CourseCopilotEventView[]) {
    if (!this.server) return;
    this.server
      .to(sessionRoom(sessionId))
      .emit(CourseCopilotSocketEvents.EVENTS, { sessionId, events });
  }
}
