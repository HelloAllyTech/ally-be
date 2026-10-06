import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HELPLINE_GUEST,
  HELPLINE_LIMITS,
  HELPLINE_TIMINGS,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineEndedReason,
  HelplineRooms,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineTalkerFeedback } from '../entity/helpline-talker-feedback.entity';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import { GuestChatDto, GuestMessageDto } from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import {
  badRequest,
  guestTokenInvalid,
  isUniqueViolation,
} from '../util/helpline-errors';
import { toGuestMessageDtos } from '../util/helpline-serializers';
import { HelplineChatLifecycleService } from './helpline-chat-lifecycle.service';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineContentCipher } from './helpline-content-cipher.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineGuestTokenService } from './helpline-guest-token.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineRetentionService } from './helpline-retention.service';

/** What HelplineGuestGuard puts on the request. */
export interface GuestContext {
  chat: HelplineChat;
  talker: HelplineTalker;
}

/**
 * Everything a talker can do over HTTP (contract §5.2). Every method receives
 * the chat and talker the guard already loaded by the token's own ids, so a
 * guest can never address another chat.
 */
@Injectable()
export class HelplineGuestService {
  constructor(
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    @InjectRepository(HelplineTalkerFeedback)
    private readonly feedback: Repository<HelplineTalkerFeedback>,
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly views: HelplineChatViewService,
    private readonly tokens: HelplineGuestTokenService,
    private readonly lifecycle: HelplineChatLifecycleService,
    private readonly retention: HelplineRetentionService,
    private readonly events: HelplineEventService,
    private readonly presence: HelplinePresenceService,
    private readonly realtime: HelplineRealtimeService,
    private readonly notify: HelplineNotifyService,
    private readonly cipher: HelplineContentCipher,
  ) {}

  async getChat(
    { chat, talker }: GuestContext,
    afterId?: number,
  ): Promise<{ chat: GuestChatDto; messages: GuestMessageDto[] }> {
    await this.touch(talker);
    return {
      chat: await this.views.guestChat(chat, talker),
      messages: toGuestMessageDtos(
        await this.messages.listTalkerVisible(
          chat.tenantId,
          chat.id,
          afterId ?? 0,
        ),
      ),
    };
  }

  /** A fresh token, allowed until 24 h after the chat ended (never past that). */
  async refresh({
    chat,
    talker,
  }: GuestContext): Promise<{ guestToken: string; expiresAt: string }> {
    let expiresAt: Date | undefined;
    if (chat.endedAt) {
      const limit =
        new Date(chat.endedAt).getTime() + HELPLINE_GUEST.REFRESH_AFTER_END_MS;
      if (Date.now() >= limit) throw guestTokenInvalid();
      expiresAt = new Date(
        Math.min(limit, Date.now() + HELPLINE_GUEST.TTL_SECONDS * 1000),
      );
    }
    const { token, expiresAt: exp } = await this.tokens.sign(
      { talkerId: talker.id, chatId: chat.id, tenantId: chat.tenantId },
      expiresAt,
    );
    return { guestToken: token, expiresAt: exp.toISOString() };
  }

  /** WAITING → TALKER_LEFT_QUEUE, ACTIVE → TALKER_ENDED, ENDED → as it is. */
  async end({ chat, talker }: GuestContext): Promise<{ chat: GuestChatDto }> {
    let current = chat;
    if (chat.status !== HelplineChatStatus.ENDED) {
      current = await this.lifecycle.endChat(
        chat,
        chat.status === HelplineChatStatus.WAITING
          ? HelplineEndedReason.TALKER_LEFT_QUEUE
          : HelplineEndedReason.TALKER_ENDED,
      );
    }
    return { chat: await this.views.guestChat(current, talker) };
  }

  /**
   * "Delete my conversation": ends the chat if open, blanks it now, revokes
   * the token and disconnects the talker's sockets. Staff see the chat flip
   * to erased; nothing of what was said survives.
   */
  async erase({ chat, talker }: GuestContext): Promise<void> {
    let current = chat;
    if (chat.status !== HelplineChatStatus.ENDED) {
      current = await this.lifecycle.endChat(
        chat,
        HelplineEndedReason.TALKER_ERASED,
      );
    }
    await this.talkers.update(
      { id: talker.id, tenantId: chat.tenantId },
      { revokedAt: new Date() },
    );
    const counts = await this.retention.blankChats(
      chat.tenantId,
      [chat.id],
      [talker.id],
    );
    await this.events.record(
      chat.tenantId,
      chat.id,
      HelplineChatEventType.ERASURE_REQUESTED,
    );
    helplineAudit('HELPLINE_ERASURE_REQUESTED', chat.tenantId, {
      chatId: chat.id,
      talkerId: talker.id,
      messagesBlanked: counts.messages,
    });
    const erased =
      (await this.chats.findById(chat.tenantId, chat.id)) ?? current;
    await this.notify.chatUpdated(erased, { talker: false });
    await this.presence
      .dropConnection('talker', talker.id)
      .catch(() => undefined);
    await this.realtime.disconnectRoom(HelplineRooms.talker(chat.id));
  }

  /** One rating per chat; a second submit keeps the first and still answers 204. */
  async submitFeedback(
    { chat }: GuestContext,
    rating: unknown,
    comment: unknown,
  ): Promise<void> {
    if (
      !Number.isInteger(rating) ||
      (rating as number) < 1 ||
      (rating as number) > 5
    ) {
      throw badRequest('rating must be a whole number from 1 to 5');
    }
    let text: string | null = null;
    if (comment != null) {
      if (typeof comment !== 'string') throw badRequest('comment must be text');
      text = comment.trim() || null;
      if (text && text.length > HELPLINE_LIMITS.FEEDBACK_COMMENT_MAX_CHARS) {
        throw badRequest(
          `comment must be at most ${HELPLINE_LIMITS.FEEDBACK_COMMENT_MAX_CHARS} characters`,
        );
      }
    }
    try {
      await this.feedback.insert({
        tenantId: chat.tenantId,
        chatId: chat.id,
        rating: rating as number,
        // Encrypted at rest; never stored for an erased chat.
        comment: chat.erasedAt ? null : await this.cipher.encryptNullable(text),
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  /** Liveness for an HTTP-only (polling) client, and a throttled last_seen_at. */
  private async touch(talker: HelplineTalker): Promise<void> {
    await this.presence
      .touchConnection('talker', talker.id)
      .catch(() => undefined);
    const last = talker.lastSeenAt ? new Date(talker.lastSeenAt).getTime() : 0;
    if (Date.now() - last > HELPLINE_TIMINGS.LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.talkers.update(
        { id: talker.id, tenantId: talker.tenantId },
        { lastSeenAt: new Date() },
      );
    }
  }
}
