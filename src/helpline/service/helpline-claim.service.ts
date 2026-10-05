import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_SYSTEM_COPY,
  HelplineAccess,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineGuestSystemKind,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { ChatDetailDto, HelplineTenant } from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import { chatNotFound, helplineError } from '../util/helpline-errors';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineCopilotService } from './helpline-copilot.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineSettingsService } from './helpline-settings.service';

export const alreadyClaimed = () =>
  helplineError(
    HttpStatus.CONFLICT,
    ErrorCode.HELPLINE_ALREADY_CLAIMED,
    'Another listener has already taken this chat',
  );

/**
 * Claiming a chat (contract §6.6). The pre-checks make the common refusals
 * specific; the UPDATE … RETURNING is what makes the claim correct — two
 * listeners clicking at once both pass the pre-checks, and exactly one gets a
 * row back.
 */
@Injectable()
export class HelplineClaimService {
  private readonly logger = LoggerService.getInstance(
    HelplineClaimService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly presence: HelplinePresenceService,
    private readonly profiles: HelplineProfileService,
    private readonly settings: HelplineSettingsService,
    private readonly writer: HelplineMessageWriter,
    private readonly events: HelplineEventService,
    private readonly views: HelplineChatViewService,
    private readonly notify: HelplineNotifyService,
    private readonly queue: HelplineQueueService,
    private readonly realtime: HelplineRealtimeService,
    private readonly copilot: HelplineCopilotService,
  ) {}

  async claim(
    tenant: HelplineTenant,
    chatId: string,
    userId: number,
  ): Promise<ChatDetailDto> {
    const before = await this.chats.findById(tenant.id, chatId);
    if (!before) throw chatNotFound();
    if (before.status === HelplineChatStatus.ENDED) throw alreadyClaimed();

    if (!(await this.presence.isAvailable(tenant.id, userId))) {
      throw helplineError(
        HttpStatus.CONFLICT,
        ErrorCode.HELPLINE_NOT_AVAILABLE,
        'Set yourself to Available (with the helpline open) before taking a chat',
      );
    }
    const settings = await this.settings.getSettings(tenant);
    const [capacity, active] = await Promise.all([
      this.profiles.capacity(
        tenant.id,
        userId,
        settings.orgMaxConcurrentPerListener,
      ),
      this.chats.countActiveForListener(tenant.id, userId),
    ]);
    if (active >= capacity) {
      throw helplineError(
        HttpStatus.CONFLICT,
        ErrorCode.HELPLINE_AT_CAPACITY,
        `You already have ${active} active chat${active === 1 ? '' : 's'} (your limit is ${capacity})`,
      );
    }

    const won = await this.chats.claim(tenant.id, chatId, userId);
    if (!won) throw alreadyClaimed();

    const chat = (await this.chats.findById(tenant.id, chatId)) as HelplineChat;
    const previousListenerId =
      before.status === HelplineChatStatus.ACTIVE ? before.listenerId : null;
    await this.afterClaim(chat, userId, previousListenerId);
    return this.views.chatDetail(chat, HelplineAccess.LISTENER);
  }

  private async afterClaim(
    chat: HelplineChat,
    userId: number,
    previousListenerId: number | null,
  ): Promise<void> {
    // The claimer's sockets on every replica join the chat's staff room first,
    // so they see everything from the ACCEPTED notice on.
    await this.realtime.joinUser(userId, HelplineRooms.staff(chat.id));

    const listenerName =
      (await this.profiles.aliases(chat.tenantId, [userId])).get(userId) ?? '';
    try {
      await this.writer.system(
        chat,
        HelplineGuestSystemKind.ACCEPTED,
        HELPLINE_SYSTEM_COPY.ACCEPTED(listenerName),
        { visibleToTalker: true, params: { listenerName } },
      );
    } catch (error) {
      this.logger.error(
        `ACCEPTED notice failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }

    const transfer = previousListenerId != null;
    await this.events.record(
      chat.tenantId,
      chat.id,
      transfer
        ? HelplineChatEventType.TRANSFERRED
        : HelplineChatEventType.CLAIMED,
      userId,
      transfer
        ? { fromListenerId: previousListenerId, toListenerId: userId }
        : { listenerId: userId },
    );
    helplineAudit(
      transfer ? 'HELPLINE_CHAT_TRANSFERRED' : 'HELPLINE_CHAT_CLAIMED',
      chat.tenantId,
      {
        chatId: chat.id,
        listenerId: userId,
        ...(transfer ? { fromListenerId: previousListenerId } : {}),
      },
      userId,
    );

    await this.realtime.emit(
      HelplineRooms.talker(chat.id),
      HelplineServerEvents.CHAT_ACCEPTED,
      { chat: await this.views.guestChat(chat) },
    );
    await this.notify.chatUpdated(chat, { talker: false });
    this.queue.queueChanged(chat.tenantId);
    await this.notify.presenceUpdated(chat.tenantId, userId);
    if (previousListenerId != null) {
      await this.notify.presenceUpdated(chat.tenantId, previousListenerId);
    }
    try {
      this.copilot.onChatClaimed(chat, previousListenerId);
    } catch (error) {
      this.logger.error(
        `copilot.onChatClaimed threw: ${(error as Error).message}`,
      );
    }
  }
}
