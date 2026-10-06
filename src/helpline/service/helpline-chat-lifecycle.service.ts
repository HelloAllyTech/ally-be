import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_SYSTEM_COPY,
  HelplineChatEventType,
  HelplineEndedReason,
  HelplineGuestSystemKind,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { helplineAudit } from '../util/helpline-audit';
import { pickLanguageText } from '../util/helpline-settings-validation';
import { HelplineCopilotService } from './helpline-copilot.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineSummaryService } from './helpline-summary.service';
import { HelplineTenantService } from './helpline-tenant.service';

/** Ends by staff get the org's own closing words; the talker chose to leave in the others. */
const CLOSING_REASONS = new Set<HelplineEndedReason>([
  HelplineEndedReason.LISTENER_ENDED,
  HelplineEndedReason.SUPERVISOR_ENDED,
]);

/**
 * The ONE way a chat ends (contract §6.5), whoever ends it: the listener, a
 * supervisor, the talker, the lifecycle sweep, erasure or a block.
 *
 * `markEnded` is a conditional UPDATE, so the side effects below run exactly
 * once even when two of those race — the sweep expiring a wait at the moment
 * the talker leaves, say. Ending an already-ended chat is a no-op that returns
 * the chat as it is (idempotent processing — see the Stacks chunk "Design for
 * idempotent message processing").
 */
@Injectable()
export class HelplineChatLifecycleService {
  private readonly logger = LoggerService.getInstance(
    HelplineChatLifecycleService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly writer: HelplineMessageWriter,
    private readonly events: HelplineEventService,
    private readonly notify: HelplineNotifyService,
    private readonly queue: HelplineQueueService,
    private readonly realtime: HelplineRealtimeService,
    private readonly summaries: HelplineSummaryService,
    private readonly settings: HelplineSettingsService,
    private readonly tenants: HelplineTenantService,
    private readonly copilot: HelplineCopilotService,
  ) {}

  async endChat(
    chat: HelplineChat,
    reason: HelplineEndedReason,
    actorUserId: number | null = null,
  ): Promise<HelplineChat> {
    const ended = await this.chats.markEnded(
      chat.tenantId,
      chat.id,
      reason,
      actorUserId,
    );
    const fresh = (await this.chats.findById(chat.tenantId, chat.id)) ?? chat;
    if (!ended) return fresh;

    await this.events.record(
      chat.tenantId,
      chat.id,
      HelplineChatEventType.ENDED,
      actorUserId,
      { reason },
    );
    helplineAudit(
      'HELPLINE_CHAT_ENDED',
      chat.tenantId,
      {
        chatId: chat.id,
        reason,
        talkerMessages: fresh.talkerMessageCount,
        listenerMessages: fresh.listenerMessageCount,
        durationSeconds: fresh.endedAt
          ? Math.round(
              (new Date(fresh.endedAt).getTime() -
                new Date(fresh.waitStartedAt).getTime()) /
                1000,
            )
          : null,
      },
      actorUserId,
    );

    try {
      await this.writeEndNotice(fresh, reason);
    } catch (error) {
      this.logger.error(
        `End notice failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }

    const payload = { chatId: chat.id, endedReason: reason };
    await this.realtime.emit(
      HelplineRooms.talker(chat.id),
      HelplineServerEvents.CHAT_ENDED,
      payload,
    );
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.CHAT_ENDED,
      payload,
    );
    await this.notify.chatUpdated(fresh, { talker: false });
    this.queue.queueChanged(chat.tenantId);
    if (fresh.listenerId != null) {
      await this.notify.presenceUpdated(chat.tenantId, fresh.listenerId);
    }

    // A summary needs a conversation: only chats a listener actually took,
    // and never one being erased.
    if (fresh.claimedAt && reason !== HelplineEndedReason.TALKER_ERASED) {
      this.summaries.scheduleFinal(fresh);
    }
    try {
      this.copilot.onChatEnded(fresh);
    } catch (error) {
      this.logger.error(
        `copilot.onChatEnded threw: ${(error as Error).message}`,
      );
    }
    return fresh;
  }

  /**
   * Talker-visible closing line. CLOSING carries the org's text in the
   * talker's language (English fallback); every other end is a fixed ENDED
   * notice the client localises. Erasure writes nothing — the content is about
   * to be blanked anyway.
   */
  private async writeEndNotice(
    chat: HelplineChat,
    reason: HelplineEndedReason,
  ): Promise<void> {
    if (reason === HelplineEndedReason.TALKER_ERASED) return;
    if (CLOSING_REASONS.has(reason)) {
      const tenant = await this.tenants.resolve(chat.tenantId);
      const settings = tenant
        ? await this.settings.getSettings(tenant)
        : this.settings.defaults;
      const text =
        pickLanguageText(settings.closingMessage, chat.language) ??
        HELPLINE_SYSTEM_COPY.ENDED;
      await this.writer.system(chat, HelplineGuestSystemKind.CLOSING, text, {
        visibleToTalker: true,
      });
      return;
    }
    await this.writer.system(
      chat,
      HelplineGuestSystemKind.ENDED,
      HELPLINE_SYSTEM_COPY.ENDED,
      { visibleToTalker: true, params: { endedReason: reason } },
    );
  }
}
