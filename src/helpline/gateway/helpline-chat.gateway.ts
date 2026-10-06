import { HttpException, Injectable } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { TenantFeatureService } from 'src/authorization/service/tenant-feature.service';
import { PreferenceName } from 'src/common/constants/user.constants';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ErrorCode } from 'src/exception/error-code.enum';
import { LoggerService } from 'src/logger/logger.service';
import { MessageBrokerChannel } from 'src/message-broker/constants/message-broker.constants';
import { MessageBrokerService } from 'src/message-broker/service/message-broker.service';
import {
  HELPLINE_LIMITS,
  HELPLINE_NAMESPACE,
  HelplineAccess,
  HelplineAckErrors,
  HelplineChatStatus,
  HelplineClientEvents,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import { HelplineChatViewService } from '../service/helpline-chat-view.service';
import { HelplineConnectionService } from '../service/helpline-connection.service';
import { HelplineListenerService } from '../service/helpline-listener.service';
import {
  HelplineMessageService,
  HelplineSendRefused,
} from '../service/helpline-message.service';
import { HelplinePresenceService } from '../service/helpline-presence.service';
import {
  HelplineBrokerEnvelope,
  HelplineRealtimeService,
} from '../service/helpline-realtime.service';
import { HelplineTenantService } from '../service/helpline-tenant.service';
import { resolveChatAccess } from '../util/helpline-access';
import {
  talkerRoomViolation,
  toGuestMessageDto,
  toGuestMessageDtos,
} from '../util/helpline-serializers';
import { TokenBucket } from '../util/helpline-token-bucket';
import {
  HelplineSocketAuthService,
  HelplineSocketData,
} from './helpline-socket-auth.service';

type Ack = { ok: true; [key: string]: unknown } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_PREFIXES = ['talker:', 'staff:', 'user:', 'lobby:', 'supervisors:'];

const fail = (error: string): Ack => ({ ok: false, error });

/** Map a thrown error to the ack's `error` string. Never leaks internals. */
export function ackErrorFor(error: unknown): string {
  if (error instanceof HelplineSendRefused) return error.reason;
  if (error instanceof HttpException) {
    const code = (error.getResponse() as { errorCode?: string })?.errorCode;
    if (code === ErrorCode.HELPLINE_CHAT_NOT_FOUND)
      return HelplineAckErrors.NOT_FOUND;
    if (code === ErrorCode.HELPLINE_CHAT_ENDED)
      return HelplineAckErrors.CHAT_ENDED;
    if (error.getStatus() === 400) return HelplineAckErrors.INVALID;
    if (error.getStatus() === 403) return HelplineAckErrors.NOT_ALLOWED;
  }
  return HelplineAckErrors.INTERNAL;
}

/**
 * `/helpline-chat` (contract §6). Routing only: the rules live in the
 * services, the payload shapes in the serialisers.
 *
 * Fan-out is the broker pattern, not a socket.io Redis adapter (contract §1):
 * every emit is published on HELPLINE_SOCKET_EMIT and each replica's
 * `applyEnvelope` delivers it to its own local sockets, re-checking the
 * talker-room guard before it does.
 *
 * Every handler runs inside `handle()`, which sets the execution context and
 * turns any exception into `{ ok: false, error }` — a bad message can never
 * crash a socket or leak a stack to a client.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: HELPLINE_NAMESPACE })
@Injectable()
export class HelplineChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = LoggerService.getInstance(HelplineChatGateway.name);
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly lastTyping = new Map<string, number>();

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly socketAuth: HelplineSocketAuthService,
    private readonly broker: MessageBrokerService,
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly views: HelplineChatViewService,
    private readonly messageService: HelplineMessageService,
    private readonly listeners: HelplineListenerService,
    private readonly connection: HelplineConnectionService,
    private readonly presence: HelplinePresenceService,
    private readonly permissions: PermissionsService,
    private readonly tenants: HelplineTenantService,
    private readonly realtime: HelplineRealtimeService,
    private readonly tenantFeatureService: TenantFeatureService,
  ) {}

  afterInit(server: Namespace): void {
    server.use(this.socketAuth.middleware());
    void this.broker
      .subscribe(MessageBrokerChannel.HELPLINE_SOCKET_EMIT, (message) =>
        this.applyEnvelope(message as HelplineBrokerEnvelope),
      )
      .catch((error) =>
        this.logger.error(
          `Helpline broker subscribe failed: ${(error as Error).message}`,
        ),
      );
  }

  /** Apply one broker instruction to THIS replica's sockets. */
  applyEnvelope(envelope: HelplineBrokerEnvelope): void {
    if (!this.server || !envelope || typeof envelope !== 'object') return;
    const known = (room: unknown) =>
      typeof room === 'string' && ROOM_PREFIXES.some((p) => room.startsWith(p));
    try {
      switch (envelope.op) {
        case 'emit': {
          if (!known(envelope.room)) return;
          const violation = talkerRoomViolation(
            envelope.room,
            envelope.event,
            envelope.payload,
          );
          if (violation) {
            this.logger.error(`Dropped emit to ${envelope.room}: ${violation}`);
            return;
          }
          let target = this.server.to(envelope.room);
          if (known(envelope.except))
            target = target.except(envelope.except as string);
          target.emit(envelope.event, envelope.payload);
          return;
        }
        case 'join':
          if (known(envelope.target) && known(envelope.room)) {
            this.server.in(envelope.target).socketsJoin(envelope.room);
          }
          return;
        case 'leave':
          if (known(envelope.target) && known(envelope.room)) {
            this.server.in(envelope.target).socketsLeave(envelope.room);
          }
          return;
        case 'disconnect':
          if (known(envelope.room))
            this.server.in(envelope.room).disconnectSockets(true);
          return;
        default:
          return;
      }
    } catch (error) {
      this.logger.error(
        `Helpline envelope failed: ${(error as Error).message}`,
      );
    }
  }

  async handleConnection(socket: Socket): Promise<void> {
    const ctx = socket.data?.helpline as HelplineSocketData | undefined;
    if (!ctx) {
      socket.disconnect(true);
      return;
    }
    await this.inContext(ctx, async () => {
      try {
        if (ctx.kind === 'talker') {
          await socket.join(HelplineRooms.talker(ctx.chatId));
          await this.connection.talkerConnected(ctx);
          return;
        }
        // A restricted socket (helpline switched off, listener of record of
        // an ACTIVE chat) gets its own user room and its chats only.
        const rooms = [HelplineRooms.user(ctx.userId)];
        if (
          !ctx.restricted &&
          ctx.permissions.includes(PERMISSIONS.VIEW_HELPLINE_LOBBY)
        ) {
          rooms.push(HelplineRooms.lobby(ctx.tenantId));
        }
        if (
          !ctx.restricted &&
          ctx.permissions.includes(PERMISSIONS.VIEW_HELPLINE_MONITOR)
        ) {
          rooms.push(HelplineRooms.supervisors(ctx.tenantId));
        }
        await socket.join(rooms);
        const chatIds = await this.connection.staffConnected(
          ctx.tenantId,
          ctx.userId,
          ctx.permissions,
        );
        if (chatIds.length) await socket.join(chatIds.map(HelplineRooms.staff));
      } catch (error) {
        this.logger.error(
          `Helpline connect handling failed for ${socket.id}: ${(error as Error).message}`,
        );
      }
    });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    this.buckets.delete(socket.id);
    this.lastTyping.delete(socket.id);
    const ctx = socket.data?.helpline as HelplineSocketData | undefined;
    if (!ctx || !this.server) return;
    await this.inContext(ctx, async () => {
      try {
        if (ctx.kind === 'talker') {
          const others = await this.server
            .in(HelplineRooms.talker(ctx.chatId))
            .fetchSockets();
          const stillHere = others.some(
            (s) =>
              (s.data?.helpline as HelplineSocketData | undefined)?.kind ===
              'talker',
          );
          await this.connection.talkerDisconnected(ctx, stillHere);
          return;
        }
        const others = await this.server
          .in(HelplineRooms.user(ctx.userId))
          .fetchSockets();
        await this.connection.staffDisconnected(
          ctx.tenantId,
          ctx.userId,
          ctx.permissions,
          others.length > 0,
        );
      } catch (error) {
        this.logger.error(
          `Helpline disconnect handling failed for ${socket.id}: ${(error as Error).message}`,
        );
      }
    });
  }

  // ── Client events ────────────────────────────────────────────────────────

  @SubscribeMessage(HelplineClientEvents.SEND_MESSAGE)
  onSendMessage(
    @ConnectedSocket() socket: Socket,
    @MessageBody()
    body: {
      chatId?: string;
      clientMessageId?: string;
      content?: string;
      suggestion?: { messageId?: number; index?: number };
    },
  ): Promise<Ack> {
    return this.handle(socket, async (ctx) => {
      if (!this.takeToken(socket.id))
        return fail(HelplineAckErrors.RATE_LIMITED);
      if (!body || typeof body !== 'object')
        return fail(HelplineAckErrors.INVALID);

      if (ctx.kind === 'talker') {
        if (body.chatId !== ctx.chatId)
          return fail(HelplineAckErrors.NOT_ALLOWED);
        const chat = await this.chats.findForGuest(
          ctx.tenantId,
          ctx.chatId,
          ctx.talkerId,
        );
        if (!chat) return fail(HelplineAckErrors.NOT_ALLOWED);
        const { message } = await this.messageService.sendTalkerText(
          chat,
          body.content,
          body.clientMessageId,
          ctx.talkerName,
        );
        return { ok: true, message: toGuestMessageDto(message) };
      }

      const chat = await this.staffChat(ctx, body.chatId);
      if (!chat) return fail(HelplineAckErrors.NOT_FOUND);
      const permissions = await this.permissions.getUserPermissions(ctx.userId);
      if (!resolveChatAccess(chat, ctx.userId, permissions)) {
        return fail(HelplineAckErrors.NOT_FOUND);
      }
      if (!permissions.includes(PERMISSIONS.EDIT_HELPLINE_MESSAGE)) {
        return fail(HelplineAckErrors.NOT_ALLOWED);
      }
      const { message } = await this.messageService.sendListenerText(
        chat,
        ctx.userId,
        body.content,
        body.clientMessageId,
        body.suggestion,
      );
      const [dto] = await this.views.staffMessages(chat, [message]);
      return { ok: true, message: dto };
    });
  }

  @SubscribeMessage(HelplineClientEvents.USER_TYPING)
  onTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { chatId?: string },
  ) {
    return this.relayTyping(socket, body, true);
  }

  @SubscribeMessage(HelplineClientEvents.USER_STOPPED_TYPING)
  onStoppedTyping(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { chatId?: string },
  ) {
    return this.relayTyping(socket, body, false);
  }

  @SubscribeMessage(HelplineClientEvents.SYNC_SINCE)
  onSyncSince(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { chatId?: string; afterId?: number },
  ): Promise<Ack> {
    return this.handle(socket, async (ctx) => {
      const afterId = Math.max(0, Math.floor(Number(body?.afterId) || 0));
      if (ctx.kind === 'talker') {
        if (body?.chatId !== ctx.chatId)
          return fail(HelplineAckErrors.NOT_ALLOWED);
        const rows = await this.messages.listTalkerVisible(
          ctx.tenantId,
          ctx.chatId,
          afterId,
        );
        return { ok: true, messages: toGuestMessageDtos(rows) };
      }
      const chat = await this.staffChat(ctx, body?.chatId);
      if (!chat) return fail(HelplineAckErrors.NOT_FOUND);
      const permissions = await this.permissions.getUserPermissions(ctx.userId);
      const access = resolveChatAccess(chat, ctx.userId, permissions);
      if (!access || !(await this.mayUseAccess(ctx, access))) {
        return fail(HelplineAckErrors.NOT_FOUND);
      }
      const rows = await this.messages.listForChat(
        ctx.tenantId,
        chat.id,
        afterId,
      );
      const talker = await this.views.findTalker(ctx.tenantId, chat.talkerId);
      return {
        ok: true,
        messages: await this.views.staffMessages(chat, rows, talker),
      };
    });
  }

  @SubscribeMessage(HelplineClientEvents.JOIN_CHAT)
  onJoinChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { chatId?: string },
  ): Promise<Ack> {
    return this.handle(socket, async (ctx) => {
      // Talkers are in their own room from the handshake and can join no other.
      if (ctx.kind !== 'staff') return fail(HelplineAckErrors.NOT_ALLOWED);
      const chat = await this.staffChat(ctx, body?.chatId);
      if (!chat) return fail(HelplineAckErrors.NOT_FOUND);
      const permissions = await this.permissions.getUserPermissions(ctx.userId);
      const access = resolveChatAccess(chat, ctx.userId, permissions);
      if (!access || !(await this.mayUseAccess(ctx, access))) {
        return fail(HelplineAckErrors.NOT_FOUND);
      }
      await socket.join(HelplineRooms.staff(chat.id));
      return { ok: true, access };
    });
  }

  @SubscribeMessage(HelplineClientEvents.LEAVE_CHAT)
  onLeaveChat(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { chatId?: string },
  ): Promise<Ack> {
    return this.handle(socket, async (ctx) => {
      if (ctx.kind !== 'staff') return fail(HelplineAckErrors.NOT_ALLOWED);
      if (typeof body?.chatId !== 'string' || !UUID.test(body.chatId)) {
        return fail(HelplineAckErrors.INVALID);
      }
      await socket.leave(HelplineRooms.staff(body.chatId));
      return { ok: true };
    });
  }

  @SubscribeMessage(HelplineClientEvents.PRESENCE_SET)
  onPresenceSet(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { status?: string },
  ): Promise<Ack> {
    return this.handle(socket, async (ctx) => {
      if (ctx.kind !== 'staff') return fail(HelplineAckErrors.NOT_ALLOWED);
      const permissions = await this.permissions.getUserPermissions(ctx.userId);
      if (!permissions.includes(PERMISSIONS.EDIT_HELPLINE_PRESENCE)) {
        return fail(HelplineAckErrors.NOT_ALLOWED);
      }
      const tenant = await this.tenants.resolve(ctx.tenantId);
      if (!tenant) return fail(HelplineAckErrors.NOT_ALLOWED);
      // Going Available is new work: refused while the helpline is off.
      // Going Away is always allowed.
      if (
        body?.status === 'AVAILABLE' &&
        (ctx.restricted || !(await this.helplineEnabled(ctx.tenantId)))
      ) {
        return fail(HelplineAckErrors.NOT_ALLOWED);
      }
      // A presence change means a live socket: refresh liveness with it.
      await this.presence.touchConnection('listener', ctx.userId);
      const presence = await this.listeners.setPresence(
        tenant,
        ctx.userId,
        body?.status,
      );
      return { ok: true, presence };
    });
  }

  @SubscribeMessage(HelplineClientEvents.HEARTBEAT)
  onHeartbeat(@ConnectedSocket() socket: Socket): Promise<Ack> {
    return this.handle(socket, async (ctx) => {
      if (ctx.kind === 'talker') {
        await this.connection.heartbeat('talker', ctx.talkerId);
      } else if (ctx.permissions.includes(PERMISSIONS.VIEW_HELPLINE_LOBBY)) {
        await this.connection.heartbeat('listener', ctx.userId);
      }
      return { ok: true };
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private helplineEnabled(tenantId: string): Promise<boolean> {
    return this.tenantFeatureService.isEnabledForTenant(
      PreferenceName.TEXT_HELPLINE_ENABLED,
      tenantId,
    );
  }

  /**
   * LISTENER access (listener of record) is always usable. READ_ONLY access —
   * monitoring, or a previous listener — is new work, so it needs the
   * helpline on and an unrestricted socket. Checked per event: the handshake
   * gate alone would leave a socket opened before the switch-off monitoring
   * after it.
   */
  private async mayUseAccess(
    ctx: Extract<HelplineSocketData, { kind: 'staff' }>,
    access: HelplineAccess,
  ): Promise<boolean> {
    if (access === HelplineAccess.LISTENER) return true;
    if (ctx.restricted) return false;
    return this.helplineEnabled(ctx.tenantId);
  }

  private async relayTyping(
    socket: Socket,
    body: { chatId?: string },
    typing: boolean,
  ): Promise<void> {
    await this.handle(socket, async (ctx) => {
      if (typing) {
        const last = this.lastTyping.get(socket.id) ?? 0;
        if (Date.now() - last < HELPLINE_LIMITS.TYPING_MIN_INTERVAL_MS)
          return { ok: true };
        this.lastTyping.set(socket.id, Date.now());
      }
      const event = typing
        ? HelplineServerEvents.USER_TYPING
        : HelplineServerEvents.USER_STOPPED_TYPING;

      if (ctx.kind === 'talker') {
        if (body?.chatId !== ctx.chatId)
          return fail(HelplineAckErrors.NOT_ALLOWED);
        await this.broadcastTyping(
          HelplineRooms.staff(ctx.chatId),
          event,
          ctx.chatId,
          'TALKER',
        );
        return { ok: true };
      }
      const chat = await this.staffChat(ctx, body?.chatId);
      if (
        !chat ||
        chat.status !== HelplineChatStatus.ACTIVE ||
        chat.listenerId !== ctx.userId
      ) {
        return fail(HelplineAckErrors.NOT_ALLOWED);
      }
      if (typing) await this.presence.setListenerTyping(chat.id);
      else await this.presence.clearListenerTyping(chat.id);
      await this.broadcastTyping(
        HelplineRooms.talker(chat.id),
        event,
        chat.id,
        'LISTENER',
      );
      return { ok: true };
    });
  }

  /** Typing goes through the realtime service like every other emit (contract §6.2). */
  private async broadcastTyping(
    room: string,
    event: string,
    chatId: string,
    role: 'TALKER' | 'LISTENER',
  ): Promise<void> {
    await this.realtime.emit(room, event, { chatId, role });
  }

  private async staffChat(
    ctx: Extract<HelplineSocketData, { kind: 'staff' }>,
    chatId: unknown,
  ): Promise<HelplineChat | null> {
    if (typeof chatId !== 'string' || !UUID.test(chatId)) return null;
    return this.chats.findById(ctx.tenantId, chatId);
  }

  private takeToken(socketId: string): boolean {
    let bucket = this.buckets.get(socketId);
    if (!bucket) {
      bucket = new TokenBucket(
        HELPLINE_LIMITS.SOCKET_BUCKET_CAPACITY,
        HELPLINE_LIMITS.SOCKET_BUCKET_REFILL_PER_SECOND,
      );
      this.buckets.set(socketId, bucket);
    }
    return bucket.take();
  }

  private inContext<T>(
    ctx: HelplineSocketData,
    fn: () => Promise<T>,
  ): Promise<T> {
    return ExecutionManager.runWithContext(
      async () => {
        ExecutionManager.setAuthContext(
          ctx.kind === 'staff' ? String(ctx.userId) : '',
          ctx.tenantId,
        );
        return fn();
      },
      { path: HELPLINE_NAMESPACE },
    );
  }

  private async handle(
    socket: Socket,
    fn: (ctx: HelplineSocketData) => Promise<Ack>,
  ): Promise<Ack> {
    const ctx = socket.data?.helpline as HelplineSocketData | undefined;
    if (!ctx) return fail(HelplineAckErrors.NOT_ALLOWED);
    return this.inContext(ctx, async () => {
      try {
        return await fn(ctx);
      } catch (error) {
        const code = ackErrorFor(error);
        if (code === HelplineAckErrors.INTERNAL) {
          this.logger.error(
            `Helpline socket handler failed for ${socket.id}: ${(error as Error)?.message}`,
          );
        }
        return fail(code);
      }
    });
  }
}
