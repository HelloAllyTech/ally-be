import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_SYSTEM_COPY,
  HelplineAccess,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineEndedReason,
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineRooms,
  HelplineSenderRole,
  HelplineServerEvents,
  HelplineStaffSystemKind,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import {
  ChatDetailDto,
  HelplineStaffUser,
  HelplineTenant,
  StaffMessageDto,
} from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import {
  badRequest,
  chatEnded,
  chatNotFound,
  helplineError,
} from '../util/helpline-errors';
import { HelplineAlertService } from './helpline-alert.service';
import { HelplineChatLifecycleService } from './helpline-chat-lifecycle.service';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineListenerService } from './helpline-listener.service';
import {
  HelplineSendRefused,
  cleanMessageContent,
} from './helpline-message.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineStaffDirectoryService } from './helpline-staff-directory.service';
import { HelplineSummaryService } from './helpline-summary.service';

const notListener = () =>
  helplineError(
    HttpStatus.FORBIDDEN,
    ErrorCode.HELPLINE_NOT_LISTENER,
    'Only the listener of this chat or a supervisor can do that',
  );

const notAssignable = () =>
  helplineError(
    HttpStatus.CONFLICT,
    ErrorCode.HELPLINE_ALREADY_CLAIMED,
    'Only a waiting chat, or one waiting for a transfer, can be assigned',
  );

/**
 * Supervision (contract §5.3, §10): transfer, assign, take-over, whisper and
 * block. Every route loads the chat tenant-scoped through the listener
 * service's access rule first, so a stranger gets 404, never 403.
 *
 * Whatever a supervisor does stays staff-side except the fixed, client-
 * localised notices a talker needs (TRANSFERRING, ACCEPTED with the new alias):
 * a talker is never told a supervisor is watching or stepped in — the Stacks
 * chunk "Live Observation Variations and Supervisor Presence" weighs the
 * client's welfare and the supervisee's dignity, and a silent hand-over keeps
 * both.
 */
@Injectable()
export class HelplineSupervisionService {
  private readonly logger = LoggerService.getInstance(
    HelplineSupervisionService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    private readonly listeners: HelplineListenerService,
    private readonly views: HelplineChatViewService,
    private readonly writer: HelplineMessageWriter,
    private readonly events: HelplineEventService,
    private readonly notify: HelplineNotifyService,
    private readonly queue: HelplineQueueService,
    private readonly realtime: HelplineRealtimeService,
    private readonly presence: HelplinePresenceService,
    private readonly profiles: HelplineProfileService,
    private readonly summaries: HelplineSummaryService,
    private readonly alerts: HelplineAlertService,
    private readonly directory: HelplineStaffDirectoryService,
    private readonly lifecycle: HelplineChatLifecycleService,
  ) {}

  // ── Transfer ─────────────────────────────────────────────────────────────

  /**
   * The listener of record (with `edit:helpline:end`) or a supervisor
   * (`edit:helpline:transfer`) puts an ACTIVE chat up for another listener,
   * optionally aimed at one. The talker is told to stay; the chat appears in
   * the lobby as `kind: 'TRANSFER'`; a HANDOFF summary is written for whoever
   * claims it. Repeating it is idempotent (a new target re-aims it).
   */
  async transfer(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
    targetListenerId?: number | null,
  ): Promise<ChatDetailDto> {
    const { chat, access, permissions } = await this.listeners.loadChat(
      tenant,
      chatId,
      user,
    );
    const supervisor = permissions.includes(PERMISSIONS.EDIT_HELPLINE_TRANSFER);
    const ownChat =
      access === HelplineAccess.LISTENER &&
      permissions.includes(PERMISSIONS.EDIT_HELPLINE_END);
    if (!supervisor && !ownChat) throw notListener();
    if (chat.status === HelplineChatStatus.ENDED) throw chatEnded();
    if (chat.status !== HelplineChatStatus.ACTIVE) {
      throw badRequest(
        'Only an active chat can be transferred; assign a waiting chat instead',
      );
    }
    const target =
      targetListenerId == null
        ? null
        : await this.requireListener(tenant, targetListenerId, chat);

    if (chat.transferRequestedAt) {
      if (target != null) {
        await this.chats.assignTarget(tenant.id, chat.id, target);
        await this.alerts.notifyAssignee(chat, target, 'TRANSFER_REQUESTED');
        this.queue.queueChanged(tenant.id);
      }
      return this.detail(tenant, chat.id, access);
    }

    const requested = await this.chats.requestTransfer(
      tenant.id,
      chat.id,
      user.id,
      target,
    );
    if (!requested) return this.detail(tenant, chat.id, access);
    const fresh = (await this.chats.findById(tenant.id, chat.id)) ?? chat;

    await this.writer.system(
      fresh,
      HelplineGuestSystemKind.TRANSFERRING,
      HELPLINE_SYSTEM_COPY.TRANSFERRING,
      { visibleToTalker: true },
    );
    await this.events.record(
      tenant.id,
      chat.id,
      HelplineChatEventType.TRANSFER_REQUESTED,
      user.id,
      { targetListenerId: target },
    );
    this.summaries.scheduleHandoff(fresh);

    const payload = {
      chatId: chat.id,
      ...(target != null ? { toListenerId: target } : {}),
    };
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.TRANSFER_REQUESTED,
      payload,
    );
    await this.realtime.emit(
      HelplineRooms.lobby(tenant.id),
      HelplineServerEvents.TRANSFER_REQUESTED,
      payload,
    );
    await this.realtime.emit(
      HelplineRooms.supervisors(tenant.id),
      HelplineServerEvents.ALERT,
      {
        type: 'TRANSFER_REQUESTED',
        chatId: chat.id,
        at: new Date().toISOString(),
      },
    );
    if (target != null) {
      await this.alerts.notifyAssignee(fresh, target, 'TRANSFER_REQUESTED');
    }
    this.queue.queueChanged(tenant.id);
    await this.notify.chatUpdated(fresh);
    return this.views.chatDetail(fresh, access);
  }

  // ── Assign ───────────────────────────────────────────────────────────────

  /**
   * A supervisor aims a WAITING or transfer-pending chat at one listener
   * (`transfer_target_listener_id`): only they can claim it, and they get an
   * ALERT and an in-app notification.
   */
  async assign(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
    listenerId: number,
  ): Promise<ChatDetailDto> {
    const { chat, access } = await this.listeners.loadChat(
      tenant,
      chatId,
      user,
    );
    if (chat.status === HelplineChatStatus.ENDED) throw chatEnded();
    const target = await this.requireListener(tenant, listenerId, chat);
    if (!(await this.chats.assignTarget(tenant.id, chat.id, target))) {
      throw notAssignable();
    }
    const fresh = (await this.chats.findById(tenant.id, chat.id)) ?? chat;
    const name =
      (await this.profiles.aliases(tenant.id, [target])).get(target) ?? '';
    await this.writer.staffOnly(
      fresh,
      HelplineMessageType.SYSTEM,
      `Assigned to ${name}.`,
      { params: { listenerName: name } },
      {
        systemKind: HelplineStaffSystemKind.ASSIGNED,
        senderRole: HelplineSenderRole.SUPERVISOR,
        senderUserId: user.id,
      },
    );
    await this.events.record(
      tenant.id,
      chat.id,
      HelplineChatEventType.ASSIGNED,
      user.id,
      { listenerId: target },
    );
    await this.alerts.notifyAssignee(fresh, target, 'ASSIGNED');
    this.queue.queueChanged(tenant.id);
    await this.notify.chatUpdated(fresh, { talker: false });
    return this.views.chatDetail(fresh, access);
  }

  // ── Take over ────────────────────────────────────────────────────────────

  /**
   * A supervisor becomes listener of record now. The previous listener keeps
   * read-only access (their sockets stay in the staff room and get the
   * READ_ONLY `CHAT_UPDATED`; sending is refused to anyone but the listener
   * of record). The talker sees only ACCEPTED with the new alias.
   */
  async takeOver(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
  ): Promise<ChatDetailDto> {
    const { chat } = await this.listeners.loadChat(tenant, chatId, user);
    if (chat.status === HelplineChatStatus.ENDED) throw chatEnded();
    if (chat.status !== HelplineChatStatus.ACTIVE) {
      throw badRequest('A waiting chat has no listener yet — claim it instead');
    }
    if (chat.listenerId === user.id) {
      return this.detail(tenant, chat.id, HelplineAccess.LISTENER);
    }
    const result = await this.chats.takeOver(tenant.id, chat.id, user.id);
    if (!result) throw chatNotFound();
    const fresh = (await this.chats.findById(tenant.id, chat.id)) ?? chat;
    const previous = result.previousListenerId;

    // Their sockets on every replica, before any notice, so they see them.
    await this.realtime.joinUser(user.id, HelplineRooms.staff(chat.id));
    const name =
      (await this.profiles.aliases(tenant.id, [user.id])).get(user.id) ?? '';
    await this.writer.staffOnly(
      fresh,
      HelplineMessageType.SYSTEM,
      `${name} took over this chat.`,
      { params: { listenerName: name } },
      {
        systemKind: HelplineStaffSystemKind.TAKEN_OVER,
        senderRole: HelplineSenderRole.SUPERVISOR,
        senderUserId: user.id,
      },
    );
    await this.writer.system(
      fresh,
      HelplineGuestSystemKind.ACCEPTED,
      HELPLINE_SYSTEM_COPY.ACCEPTED(name),
      { visibleToTalker: true, params: { listenerName: name } },
    );
    await this.events.record(
      tenant.id,
      chat.id,
      HelplineChatEventType.TAKEN_OVER,
      user.id,
      { fromListenerId: previous, toListenerId: user.id },
    );
    helplineAudit(
      'HELPLINE_CHAT_TRANSFERRED',
      tenant.id,
      {
        chatId: chat.id,
        listenerId: user.id,
        fromListenerId: previous,
        takeOver: true,
      },
      user.id,
    );
    await this.notify.chatUpdated(fresh);
    await this.notify.presenceUpdated(tenant.id, user.id);
    if (previous != null) {
      await this.notify.presenceUpdated(tenant.id, previous);
    }
    this.queue.queueChanged(tenant.id);
    return this.views.chatDetail(fresh, HelplineAccess.LISTENER);
  }

  // ── Whisper ──────────────────────────────────────────────────────────────

  /**
   * A staff-only note into an open chat: persisted as WHISPER
   * (`visible_to_talker = false`, which the DB CHECK also enforces) and
   * emitted as `WHISPER` to `staff:{chatId}` only.
   */
  async whisper(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
    rawContent: unknown,
  ): Promise<StaffMessageDto> {
    const { chat } = await this.listeners.loadChat(tenant, chatId, user);
    if (chat.status === HelplineChatStatus.ENDED) throw chatEnded();
    let content: string;
    try {
      content = cleanMessageContent(rawContent);
    } catch (error) {
      if (error instanceof HelplineSendRefused) {
        throw badRequest(
          error.reason === 'too_long'
            ? 'A whisper must be at most 2000 characters'
            : 'A whisper cannot be empty',
        );
      }
      throw error;
    }
    const row = await this.writer.staffOnly(
      chat,
      HelplineMessageType.WHISPER,
      content,
      null,
      {
        senderRole: HelplineSenderRole.SUPERVISOR,
        senderUserId: user.id,
        emit: false,
      },
    );
    const [dto] = await this.views.staffMessages(chat, [row]);
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.WHISPER,
      { chatId: chat.id, message: dto },
    );
    return dto;
  }

  // ── Block ────────────────────────────────────────────────────────────────

  /**
   * Ends the talker's open chat(s) as TALKER_BLOCKED, revokes their token,
   * disconnects them, and records `blocked_at` — which is what
   * HelplineSessionService.isBlocked keys the 24 h `ip_hash` refusal on (and
   * why retention keeps a blocked talker's `ip_hash`). The free-text reason is
   * accepted but not stored anywhere: it would be text about a person, and
   * only the HIPAA audit logger may hold that — the audit records whether one
   * was given.
   */
  async block(
    tenant: HelplineTenant,
    talkerId: string,
    user: HelplineStaffUser,
    reason?: string | null,
  ): Promise<void> {
    const talker = await this.talkers.findOne({
      where: { id: talkerId, tenantId: tenant.id },
    });
    if (!talker) throw chatNotFound();
    const now = new Date();
    await this.talkers.update(
      { id: talker.id, tenantId: tenant.id },
      {
        blockedAt: talker.blockedAt ?? now,
        blockedBy: talker.blockedBy ?? user.id,
        revokedAt: talker.revokedAt ?? now,
      },
    );
    const open = await this.chats.listOpenForTalker(tenant.id, talker.id);
    for (const chat of open) {
      await this.lifecycle.endChat(
        chat,
        HelplineEndedReason.TALKER_BLOCKED,
        user.id,
      );
      await this.events.record(
        tenant.id,
        chat.id,
        HelplineChatEventType.TALKER_BLOCKED,
        user.id,
      );
      await this.realtime.disconnectRoom(HelplineRooms.talker(chat.id));
    }
    await this.presence
      .dropConnection('talker', talker.id)
      .catch(() => undefined);
    helplineAudit(
      'HELPLINE_TALKER_BLOCKED',
      tenant.id,
      {
        talkerId: talker.id,
        chatsEnded: open.length,
        reasonGiven: typeof reason === 'string' && reason.trim().length > 0,
      },
      user.id,
    );
    this.logger.info(
      `Helpline talker ${talker.id} blocked by user ${user.id} (${open.length} chat(s) ended)`,
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** The target must be a listener of THIS tenant, and not the current one. */
  private async requireListener(
    tenant: HelplineTenant,
    listenerId: number,
    chat: Pick<HelplineChat, 'listenerId'>,
  ): Promise<number> {
    const id = Number(listenerId);
    if (!Number.isInteger(id)) throw badRequest('listenerId must be a user id');
    if (chat.listenerId === id) {
      throw badRequest('That listener already has this chat');
    }
    const listeners = await this.directory.usersWithPermission(
      tenant,
      PERMISSIONS.VIEW_HELPLINE_LOBBY,
    );
    if (!listeners.some((l) => l.id === id)) {
      throw badRequest('That user is not a listener in this organisation');
    }
    return id;
  }

  private async detail(
    tenant: HelplineTenant,
    chatId: string,
    access: HelplineAccess,
  ): Promise<ChatDetailDto> {
    const fresh = await this.chats.findById(tenant.id, chatId);
    if (!fresh) throw chatNotFound();
    return this.views.chatDetail(fresh, access);
  }
}
