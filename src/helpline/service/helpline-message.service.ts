import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_LIMITS,
  HelplineChatStatus,
  HelplineMessageType,
  HelplineSenderRole,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import { editDistance } from '../util/helpline-serializers';
import { isUniqueViolation } from '../util/helpline-errors';
import { HelplineCopilotService } from './helpline-copilot.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRiskService } from './helpline-risk.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why a send was refused, as the socket ack spells it (contract §6.3). */
export type SendRefusal =
  | 'empty'
  | 'too_long'
  | 'chat_ended'
  | 'not_allowed'
  | 'invalid';

export class HelplineSendRefused extends Error {
  constructor(readonly reason: SendRefusal) {
    super(reason);
  }
}

/** Trim and bound a message body; throws the refusal the ack reports. */
export function cleanMessageContent(raw: unknown): string {
  if (typeof raw !== 'string') throw new HelplineSendRefused('empty');
  const content = raw.trim();
  if (!content) throw new HelplineSendRefused('empty');
  if (content.length > HELPLINE_LIMITS.MESSAGE_MAX_CHARS) {
    throw new HelplineSendRefused('too_long');
  }
  return content;
}

export function cleanClientMessageId(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !UUID.test(raw)) {
    throw new HelplineSendRefused('invalid');
  }
  return raw.toLowerCase();
}

export interface SendResult {
  message: HelplineMessage;
  /** True when this was a resend of an already-stored clientMessageId. */
  duplicate: boolean;
}

/**
 * Talker and listener TEXT messages (contract §6.3 SEND_MESSAGE).
 *
 * Order is the point: persist → emit → keyword screen → copilot hook. Delivery
 * never waits for anything that can be slow or fail (invariant 3). A resend
 * with the same `clientMessageId` returns the stored row and emits nothing —
 * the other side already has it, and a duplicate bubble is worse than none
 * (idempotent processing).
 */
@Injectable()
export class HelplineMessageService {
  private readonly logger = LoggerService.getInstance(
    HelplineMessageService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly writer: HelplineMessageWriter,
    private readonly risk: HelplineRiskService,
    private readonly queue: HelplineQueueService,
    private readonly copilot: HelplineCopilotService,
  ) {}

  /** A talker writes — in the waiting room (WAITING) or the chat (ACTIVE). */
  async sendTalkerText(
    chat: HelplineChat,
    rawContent: unknown,
    rawClientMessageId: unknown,
    talkerName: string | null,
  ): Promise<SendResult> {
    if (
      chat.status !== HelplineChatStatus.WAITING &&
      chat.status !== HelplineChatStatus.ACTIVE
    ) {
      throw new HelplineSendRefused('chat_ended');
    }
    const content = cleanMessageContent(rawContent);
    const clientMessageId = cleanClientMessageId(rawClientMessageId);

    const stored = await this.persist(chat, {
      senderRole: HelplineSenderRole.TALKER,
      senderUserId: null,
      content,
      clientMessageId,
      metadata: null,
    });
    if (stored.duplicate) return stored;

    await this.writer.emit(chat, stored.message, talkerName);
    const count = await this.chats.recordTalkerMessage(chat.tenantId, chat.id);
    chat.talkerMessageCount = count;

    // The lobby preview is the first talker message: show it as soon as it exists.
    if (chat.status === HelplineChatStatus.WAITING && count === 1) {
      this.queue.queueChanged(chat.tenantId);
    }

    await this.risk.screenTalkerMessage(chat, stored.message);
    this.fireHook(() => this.copilot.onTalkerMessage(chat, stored.message));
    return stored;
  }

  /**
   * The listener of record (or a supervisor after take-over) writes. The
   * caller has already checked the permission; this checks the chat state and
   * that the sender IS the listener of record.
   */
  async sendListenerText(
    chat: HelplineChat,
    userId: number,
    rawContent: unknown,
    rawClientMessageId: unknown,
    suggestion?: { messageId?: unknown; index?: unknown } | null,
  ): Promise<SendResult> {
    if (chat.status === HelplineChatStatus.ENDED) {
      throw new HelplineSendRefused('chat_ended');
    }
    if (
      chat.status !== HelplineChatStatus.ACTIVE ||
      chat.listenerId !== userId
    ) {
      throw new HelplineSendRefused('not_allowed');
    }
    const content = cleanMessageContent(rawContent);
    const clientMessageId = cleanClientMessageId(rawClientMessageId);
    const metadata = await this.suggestionMetadata(chat, content, suggestion);

    const stored = await this.persist(chat, {
      senderRole: chat.takenOverAt
        ? HelplineSenderRole.SUPERVISOR
        : HelplineSenderRole.LISTENER,
      senderUserId: userId,
      content,
      clientMessageId,
      metadata,
    });
    if (stored.duplicate) return stored;

    await this.writer.emit(chat, stored.message);
    await this.chats.recordListenerMessage(chat.tenantId, chat.id);
    this.fireHook(() => this.copilot.onListenerMessage(chat, stored.message));
    return stored;
  }

  private async persist(
    chat: HelplineChat,
    row: {
      senderRole: HelplineSenderRole;
      senderUserId: number | null;
      content: string;
      clientMessageId: string | null;
      metadata: Record<string, unknown> | null;
    },
  ): Promise<SendResult> {
    if (row.clientMessageId) {
      const existing = await this.messages.findByClientMessageId(
        chat.tenantId,
        chat.id,
        row.clientMessageId,
      );
      if (existing) return { message: existing, duplicate: true };
    }
    try {
      const message = await this.messages.insert({
        tenantId: chat.tenantId,
        chatId: chat.id,
        senderRole: row.senderRole,
        senderUserId: row.senderUserId,
        type: HelplineMessageType.TEXT,
        systemKind: null,
        content: row.content,
        clientMessageId: row.clientMessageId,
        visibleToTalker: true,
        metadata: row.metadata,
      });
      return { message, duplicate: false };
    } catch (error) {
      // Two sockets resent the same message at once: the unique index let
      // exactly one through, and the loser returns the winner's row.
      if (row.clientMessageId && isUniqueViolation(error)) {
        const existing = await this.messages.findByClientMessageId(
          chat.tenantId,
          chat.id,
          row.clientMessageId,
        );
        if (existing) return { message: existing, duplicate: true };
      }
      throw error;
    }
  }

  /**
   * `fromSuggestion` (StaffMessageDto) when the listener sent an edited copilot
   * suggestion. Dropped silently when the reference does not resolve — a stale
   * suggestion id must never block a send.
   */
  private async suggestionMetadata(
    chat: HelplineChat,
    content: string,
    suggestion?: { messageId?: unknown; index?: unknown } | null,
  ): Promise<Record<string, unknown> | null> {
    if (!suggestion) return null;
    const messageId = Number(suggestion.messageId);
    const index = Number(suggestion.index);
    if (!Number.isInteger(messageId) || !Number.isInteger(index)) return null;
    const source = await this.messages.findById(
      chat.tenantId,
      chat.id,
      messageId,
    );
    if (!source || source.type !== HelplineMessageType.SUGGESTION) return null;
    const items = (source.metadata?.suggestions ?? []) as {
      index?: number;
      text?: string;
    }[];
    const item = Array.isArray(items)
      ? items.find((s) => s.index === index)
      : undefined;
    if (!item?.text) return null;
    return {
      fromSuggestion: {
        messageId,
        index,
        editedDistance: editDistance(item.text, content),
      },
    };
  }

  private fireHook(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.error(`Copilot hook threw: ${(error as Error).message}`);
    }
  }
}
