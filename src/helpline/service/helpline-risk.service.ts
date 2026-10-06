import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_LIMITS,
  HELPLINE_RISK_MESSAGE_COPY,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineMessageType,
  HelplineRiskFlagLevel,
  HelplineRiskOutcome,
  HelplineRiskSource,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineRiskFlag } from '../entity/helpline-risk-flag.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { RiskFlagDto } from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import { badRequest, chatNotFound } from '../util/helpline-errors';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineContentCipher } from './helpline-content-cipher.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineRiskKeywordService } from './helpline-risk-keyword.service';

/**
 * Risk flags (contract §9.3). Phase 1 implements the keyword source end to end
 * — flag row (offsets only), staff-only RISK message, monotonic `risk_level`,
 * lobby priority, `RISK_FLAGGED` with the live signal to staff, HIPAA audit —
 * and leaves `onHighRisk` as the seam for the HIGH-only side effects
 * (supervisor alerts and auto-sent emergency resources).
 */
@Injectable()
export class HelplineRiskService {
  private readonly logger = LoggerService.getInstance(HelplineRiskService.name);

  constructor(
    @InjectRepository(HelplineRiskFlag)
    private readonly flags: Repository<HelplineRiskFlag>,
    private readonly chats: HelplineChatRepository,
    private readonly keywords: HelplineRiskKeywordService,
    private readonly writer: HelplineMessageWriter,
    private readonly views: HelplineChatViewService,
    private readonly events: HelplineEventService,
    private readonly queue: HelplineQueueService,
    private readonly realtime: HelplineRealtimeService,
    private readonly cipher: HelplineContentCipher,
  ) {}

  /**
   * Keyword-screen one persisted talker TEXT (waiting room included). Runs
   * after the message was delivered and never throws into the send path.
   */
  async screenTalkerMessage(
    chat: HelplineChat,
    message: HelplineMessage,
  ): Promise<HelplineRiskFlag | null> {
    try {
      const hit = await this.keywords.screen(chat.tenantId, message.content);
      if (!hit) return null;
      return await this.raiseFlag(chat, message, {
        level: hit.rule.level,
        source: HelplineRiskSource.KEYWORD,
        confidence: null,
        subject: null,
        ruleId: hit.rule.id,
        signalStart: hit.start,
        signalEnd: hit.end,
      });
    } catch (error) {
      this.logger.error(
        `Keyword screen failed for chat ${chat.id}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Record a flag from any source. Public so the classifier (second pass)
   * goes through exactly the same path as the keyword screen.
   */
  async raiseFlag(
    chat: HelplineChat,
    message: HelplineMessage,
    input: Pick<
      HelplineRiskFlag,
      | 'level'
      | 'source'
      | 'confidence'
      | 'subject'
      | 'ruleId'
      | 'signalStart'
      | 'signalEnd'
    >,
  ): Promise<HelplineRiskFlag> {
    const flag = await this.flags.save(
      this.flags.create({
        tenantId: chat.tenantId,
        chatId: chat.id,
        messageId: message.id,
        ...input,
        outcome: HelplineRiskOutcome.UNREVIEWED,
      }),
    );

    await this.writer.staffOnly(
      chat,
      HelplineMessageType.RISK,
      HELPLINE_RISK_MESSAGE_COPY[flag.level],
      {
        flagId: flag.id,
        level: flag.level,
        source: flag.source,
        confidence: flag.confidence,
        subject: flag.subject,
      },
      { parentMessageId: message.id },
    );

    const raised = await this.chats.raiseRisk(
      chat.tenantId,
      chat.id,
      flag.level,
    );
    if (raised) {
      chat.riskLevel = raised.riskLevel;
      chat.priority = raised.priority;
    }

    await this.events.record(
      chat.tenantId,
      chat.id,
      HelplineChatEventType.RISK_FLAGGED,
      null,
      { flagId: flag.id, level: flag.level, source: flag.source },
    );

    const dto = this.views.riskFlagDto(flag, message);
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.RISK_FLAGGED,
      { chatId: chat.id, flag: dto },
    );
    if (chat.status === HelplineChatStatus.WAITING) {
      this.queue.queueChanged(chat.tenantId);
    }

    // The audit logger is the one sink allowed the matched text (invariant 5).
    helplineAudit('HELPLINE_RISK_FLAGGED', chat.tenantId, {
      chatId: chat.id,
      flagId: flag.id,
      level: flag.level,
      source: flag.source,
      signal: dto.signal,
    });

    if (flag.level === HelplineRiskFlagLevel.HIGH) {
      await this.onHighRisk(chat, flag);
    }
    return flag;
  }

  /**
   * HIGH-risk side effects beyond the flag itself (contract §9.3): supervisor
   * alerts (in-app + push + optional Slack, deduped 1 per chat per 10 min,
   * never the text) and the org's emergency resources sent to the talker as a
   * SYSTEM `RESOURCES` message once per chat (`resources_sent_at`).
   *
   * Intentionally empty in Phase 1 — the second backend pass fills it. It is
   * awaited inside `raiseFlag`, which already runs after delivery, so an
   * implementation should still not block for long.
   */
  async onHighRisk(chat: HelplineChat, flag: HelplineRiskFlag): Promise<void> {
    void chat;
    void flag;
  }

  /** Listener / supervisor marks a flag CONFIRMED or FALSE_POSITIVE (calibration). */
  async acknowledge(
    chat: HelplineChat,
    flagId: string,
    userId: number,
    outcome: HelplineRiskOutcome,
    note: string | null | undefined,
  ): Promise<RiskFlagDto> {
    if (
      outcome !== HelplineRiskOutcome.CONFIRMED &&
      outcome !== HelplineRiskOutcome.FALSE_POSITIVE
    ) {
      throw badRequest('outcome must be CONFIRMED or FALSE_POSITIVE');
    }
    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > HELPLINE_LIMITS.OUTCOME_NOTE_MAX_CHARS) {
      throw badRequest(
        `note must be at most ${HELPLINE_LIMITS.OUTCOME_NOTE_MAX_CHARS} characters`,
      );
    }
    const flag = await this.flags.findOne({
      where: { id: flagId, tenantId: chat.tenantId, chatId: chat.id },
    });
    if (!flag) throw chatNotFound();

    flag.outcome = outcome;
    // Encrypted at rest (free text about a person in distress).
    flag.outcomeNote = chat.erasedAt
      ? null
      : await this.cipher.encryptNullable(trimmed);
    flag.acknowledgedBy = flag.acknowledgedBy ?? userId;
    flag.acknowledgedAt = flag.acknowledgedAt ?? new Date();
    await this.flags.save(flag);

    // The note is free text and stays out of the timeline.
    await this.events.record(
      chat.tenantId,
      chat.id,
      HelplineChatEventType.RISK_ACKNOWLEDGED,
      userId,
      { flagId: flag.id, outcome },
    );

    const [dto] = await this.views.riskFlags(chat, [flag]);
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.RISK_FLAG_UPDATED,
      { chatId: chat.id, flag: dto },
    );
    return dto;
  }
}
