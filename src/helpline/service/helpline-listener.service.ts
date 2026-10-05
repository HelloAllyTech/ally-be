import { HttpStatus, Injectable } from '@nestjs/common';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  HELPLINE_LIMITS,
  HelplineAccess,
  HelplineChatStatus,
  HelplineEndedReason,
  HelplinePresence,
  HelplineRiskOutcome,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import {
  ChatDetailDto,
  ChatListItemDto,
  HelplineStaffUser,
  HelplineTenant,
  ListenerProfileDto,
  LobbyDto,
  MeDto,
  RiskFlagDto,
  StaffMessageDto,
  SummaryDto,
} from '../type/helpline.types';
import { resolveChatAccess } from '../util/helpline-access';
import { helplineAudit } from '../util/helpline-audit';
import {
  badRequest,
  chatNotFound,
  helplineError,
} from '../util/helpline-errors';
import { HelplineChatLifecycleService } from './helpline-chat-lifecycle.service';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRiskService } from './helpline-risk.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineSummaryService } from './helpline-summary.service';

export interface StaffChatAccess {
  chat: HelplineChat;
  access: HelplineAccess;
  permissions: string[];
}

const notListener = () =>
  helplineError(
    HttpStatus.FORBIDDEN,
    ErrorCode.HELPLINE_NOT_LISTENER,
    'Only the listener of this chat can do that',
  );

/**
 * The listener / supervisor HTTP surface (contract §5.3). Every method takes
 * the already-resolved tenant (the gate has run) and loads chats with that
 * tenant in the WHERE clause; `loadChat` then applies the per-chat access
 * rule, answering 404 rather than 403 to a stranger.
 */
@Injectable()
export class HelplineListenerService {
  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly permissions: PermissionsService,
    private readonly settings: HelplineSettingsService,
    private readonly profiles: HelplineProfileService,
    private readonly presence: HelplinePresenceService,
    private readonly views: HelplineChatViewService,
    private readonly queue: HelplineQueueService,
    private readonly notify: HelplineNotifyService,
    private readonly lifecycle: HelplineChatLifecycleService,
    private readonly summaries: HelplineSummaryService,
    private readonly risk: HelplineRiskService,
  ) {}

  async loadChat(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
  ): Promise<StaffChatAccess> {
    const chat = await this.chats.findById(tenant.id, chatId);
    if (!chat) throw chatNotFound();
    const permissions = await this.permissions.getUserPermissions(user.id);
    const access = resolveChatAccess(chat, user.id, permissions);
    if (!access) throw chatNotFound();
    return { chat, access, permissions };
  }

  // ── Me / presence ────────────────────────────────────────────────────────

  async me(tenant: HelplineTenant, userId: number): Promise<MeDto> {
    const settings = await this.settings.getSettings(tenant);
    const [profile, presence, activeChatCount] = await Promise.all([
      this.profiles.getProfile(
        tenant.id,
        userId,
        settings.orgMaxConcurrentPerListener,
      ),
      this.presence.getPresence(tenant.id, userId),
      this.chats.countActiveForListener(tenant.id, userId),
    ]);
    return {
      userId,
      profile,
      presence,
      activeChatCount,
      orgMaxConcurrentPerListener: settings.orgMaxConcurrentPerListener,
      settings: this.settings.toListenerSettings(settings),
    };
  }

  async updateProfile(
    tenant: HelplineTenant,
    userId: number,
    patch: Partial<ListenerProfileDto>,
  ): Promise<MeDto> {
    const settings = await this.settings.getSettings(tenant);
    await this.profiles.updateProfile(
      tenant.id,
      userId,
      settings.orgMaxConcurrentPerListener,
      patch,
    );
    return this.me(tenant, userId);
  }

  /** Shared by PUT /me/presence and the PRESENCE_SET socket event. */
  async setPresence(
    tenant: HelplineTenant,
    userId: number,
    status: unknown,
  ): Promise<HelplinePresence> {
    if (
      status !== HelplinePresence.AVAILABLE &&
      status !== HelplinePresence.AWAY
    ) {
      throw badRequest('status must be AVAILABLE or AWAY');
    }
    await this.presence.setPresence(tenant.id, userId, status);
    await this.notify.presenceUpdated(tenant.id, userId);
    // Availability feeds `open` and the lobby counts: refresh both now.
    this.queue.queueChanged(tenant.id);
    return this.presence.getPresence(tenant.id, userId);
  }

  // ── Lobby ────────────────────────────────────────────────────────────────

  async lobby(tenant: HelplineTenant, userId: number): Promise<LobbyDto> {
    const [{ waiting, counts }, mine] = await Promise.all([
      this.queue.buildQueue(tenant.id),
      this.chats.listActiveForListener(tenant.id, userId),
    ]);
    return {
      waiting,
      myChats: await this.views.chatListItems(tenant.id, mine),
      counts,
    };
  }

  // ── Chats ────────────────────────────────────────────────────────────────

  async chatDetail(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
  ): Promise<ChatDetailDto> {
    const { chat, access } = await this.loadChat(tenant, chatId, user);
    this.auditTranscriptAccess(chat, user.id, access);
    return this.views.chatDetail(chat, access);
  }

  async chatMessages(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
    afterId?: number,
  ): Promise<{ messages: StaffMessageDto[] }> {
    const { chat, access } = await this.loadChat(tenant, chatId, user);
    this.auditTranscriptAccess(chat, user.id, access);
    const [rows, talker] = await Promise.all([
      this.messages.listForChat(tenant.id, chat.id, afterId ?? 0),
      this.views.findTalker(tenant.id, chat.talkerId),
    ]);
    return { messages: await this.views.staffMessages(chat, rows, talker) };
  }

  /**
   * The listener of record ends it (LISTENER_ENDED); a supervisor who is not
   * the listener ends it as SUPERVISOR_ENDED. Ending an ended chat returns it.
   */
  async endChat(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
  ): Promise<ChatDetailDto> {
    const { chat, access, permissions } = await this.loadChat(
      tenant,
      chatId,
      user,
    );
    if (chat.status !== HelplineChatStatus.ENDED) {
      if (access === HelplineAccess.LISTENER) {
        await this.lifecycle.endChat(
          chat,
          HelplineEndedReason.LISTENER_ENDED,
          user.id,
        );
      } else if (permissions.includes(PERMISSIONS.EDIT_HELPLINE_TRANSFER)) {
        await this.lifecycle.endChat(
          chat,
          HelplineEndedReason.SUPERVISOR_ENDED,
          user.id,
        );
      } else {
        throw notListener();
      }
    }
    const fresh = (await this.chats.findById(tenant.id, chat.id)) ?? chat;
    return this.views.chatDetail(fresh, access);
  }

  async saveSummary(
    tenant: HelplineTenant,
    chatId: string,
    user: HelplineStaffUser,
    fields: unknown,
  ): Promise<SummaryDto> {
    const { chat, access, permissions } = await this.loadChat(
      tenant,
      chatId,
      user,
    );
    if (
      access !== HelplineAccess.LISTENER &&
      !permissions.includes(PERMISSIONS.VIEW_HELPLINE_MONITOR)
    ) {
      throw notListener();
    }
    return this.summaries.saveFinalEdit(chat, user.id, fields);
  }

  async listChats(
    tenant: HelplineTenant,
    user: HelplineStaffUser,
    query: { scope?: string; status?: string; page?: number; limit?: number },
  ): Promise<{ items: ChatListItemDto[]; total: number }> {
    const scope = query.scope === 'all' ? 'all' : 'mine';
    if (scope === 'all') {
      const permissions = await this.permissions.getUserPermissions(user.id);
      if (!permissions.includes(PERMISSIONS.VIEW_HELPLINE_MONITOR)) {
        throw helplineError(
          HttpStatus.FORBIDDEN,
          ErrorCode.PERMISSION_DENIED,
          `scope=all requires ${PERMISSIONS.VIEW_HELPLINE_MONITOR}`,
        );
      }
    }
    const status = (Object.values(HelplineChatStatus) as string[]).includes(
      query.status ?? '',
    )
      ? (query.status as HelplineChatStatus)
      : undefined;
    const limit = Math.min(
      Math.max(1, Math.floor(Number(query.limit) || 25)),
      HELPLINE_LIMITS.CHAT_LIST_MAX_LIMIT,
    );
    const page = Math.max(1, Math.floor(Number(query.page) || 1));
    const [rows, total] = await this.chats.listPage(
      tenant.id,
      { mineFor: scope === 'mine' ? user.id : undefined, status },
      (page - 1) * limit,
      limit,
    );
    return { items: await this.views.chatListItems(tenant.id, rows), total };
  }

  async acknowledgeFlag(
    tenant: HelplineTenant,
    chatId: string,
    flagId: string,
    user: HelplineStaffUser,
    outcome: HelplineRiskOutcome,
    note?: string | null,
  ): Promise<RiskFlagDto> {
    const { chat } = await this.loadChat(tenant, chatId, user);
    return this.risk.acknowledge(chat, flagId, user.id, outcome, note);
  }

  /** Reading an ENDED transcript is a HIPAA access event. */
  private auditTranscriptAccess(
    chat: HelplineChat,
    userId: number,
    access: HelplineAccess,
  ): void {
    if (chat.status !== HelplineChatStatus.ENDED) return;
    helplineAudit(
      'HELPLINE_TRANSCRIPT_ACCESSED',
      chat.tenantId,
      { chatId: chat.id, access },
      userId,
    );
  }
}
