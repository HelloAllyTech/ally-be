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

import { RoadmapEvents } from '../enum/roadmap-events.enum';
import { RoadmapEvent } from '../type/roadmap-event.type';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';
import { RoadmapCommentService } from '../service/roadmap-comment.service';

const BOARD_ROOM = 'roadmap:board';
const opportunityRoom = (opportunityId: string) =>
  `roadmap:opportunity:${opportunityId}`;

/**
 * Live updates for the roadmap board, replacing the standalone app's Supabase Realtime
 * subscription.
 *
 * The middleware gates on VIEW only, on purpose: this socket is READ-ONLY. Every mutation still
 * goes through an HTTP handler with its own @AuthPermissions, so a client holding view: can
 * watch the board update but cannot change anything through here.
 *
 * TWO ROOMS. Board-wide traffic (votes, opportunity changes) goes to everyone; comment traffic
 * goes only to clients that have a drawer open on that opportunity. The source subscribed
 * per-opportunity for comments too, and preserving that means a comment on one opportunity
 * doesn't wake every client watching 500 rows.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: the source subscribed to 9 tables and, on ANY change,
 * ran a 400ms-debounced reload of ALL 12 tables on EVERY connected client. Ten people voting
 * meant ten full reloads a second, each one discarding in-flight optimistic state. Here the
 * high-frequency path is a ~100-byte delta the client patches in place.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/product-roadmap',
})
@Injectable()
export class RoadmapGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(RoadmapGateway.name);

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly notifications: RoadmapNotificationService,
    private readonly commentService: RoadmapCommentService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.VIEW_PRODUCT_ROADMAP,
      ]),
    );

    // Services emit through the notification registry and never import this gateway — that is
    // what keeps them testable and free of a circular dependency.
    this.notifications.addListener((event) => this.dispatch(event));
  }

  onModuleDestroy() {
    this.notifications.removeListener();
  }

  handleConnection(client: any) {
    const user = client.data?.user;
    if (!user) {
      client.disconnect();
      return;
    }
    client.emit(RoadmapEvents.CONNECTED, { userId: user.id });
  }

  handleDisconnect(client: any) {
    this.logger.debug(`[ROADMAP] Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage(RoadmapEvents.JOIN_BOARD)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinBoard(client: any): Promise<void> {
    if (!client.data?.user) {
      client.disconnect();
      return;
    }
    await client.join(BOARD_ROOM);
  }

  @SubscribeMessage(RoadmapEvents.JOIN_OPPORTUNITY)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinOpportunity(
    client: any,
    payload: { opportunityId?: string },
  ): Promise<void> {
    const user = client.data?.user;
    const opportunityId = payload?.opportunityId;
    if (!user || !opportunityId) return;

    await client.join(opportunityRoom(opportunityId));

    // Initial snapshot to the joining client only, so it has one code path for "get the
    // comments" whether it arrived over HTTP or over the socket.
    try {
      const comments = await this.commentService.list(opportunityId);
      client.emit(RoadmapEvents.COMMENT_CHANGED, {
        opportunityId,
        action: 'snapshot',
        comments,
      });
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Failed to send comment snapshot for ${opportunityId}: ${(error as Error)?.message}`,
      );
    }
  }

  @SubscribeMessage(RoadmapEvents.LEAVE_OPPORTUNITY)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleLeaveOpportunity(
    client: any,
    payload: { opportunityId?: string },
  ): Promise<void> {
    if (!payload?.opportunityId) return;
    await client.leave(opportunityRoom(payload.opportunityId));
  }

  /**
   * Fan out one service event.
   *
   * Every payload carries `actorId`. That is a HARD CONTRACT with the client, which uses it to
   * suppress its own echo — without it, your own coin click round-trips a broadcast that
   * invalidates the list and refetches over your optimistic patch while your finger is still on
   * the button.
   */
  private dispatch(event: RoadmapEvent): void {
    if (!this.server) return;

    switch (event.kind) {
      case 'ALLOCATION_CHANGED':
        this.server
          .to(BOARD_ROOM)
          .emit(RoadmapEvents.ALLOCATION_CHANGED, event);
        break;

      case 'OPPORTUNITY_UPSERTED':
        this.server
          .to(BOARD_ROOM)
          .emit(RoadmapEvents.OPPORTUNITY_UPSERTED, event);
        this.server
          .to(opportunityRoom(event.opportunity.id))
          .emit(RoadmapEvents.OPPORTUNITY_UPSERTED, event);
        break;

      case 'OPPORTUNITY_DELETED':
        this.server
          .to(BOARD_ROOM)
          .emit(RoadmapEvents.OPPORTUNITY_DELETED, event);
        this.server
          .to(opportunityRoom(event.opportunityId))
          .emit(RoadmapEvents.OPPORTUNITY_DELETED, event);
        break;

      case 'COMMENT_CHANGED':
        // Room-scoped only — the board does not need comment traffic. The client keeps its
        // own commentCount in step via the count in the next list fetch.
        this.server
          .to(opportunityRoom(event.opportunityId))
          .emit(RoadmapEvents.COMMENT_CHANGED, event);
        break;

      case 'ROADMAP_INVALIDATED':
        this.server
          .to(BOARD_ROOM)
          .emit(RoadmapEvents.ROADMAP_INVALIDATED, event);
        break;
    }
  }
}
