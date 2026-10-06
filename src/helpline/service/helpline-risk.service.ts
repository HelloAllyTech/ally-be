import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_LIMITS,
  HELPLINE_RISK_MESSAGE_COPY,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineRiskFlagLevel,
  HelplineRiskOutcome,
  HelplineRiskSource,
  HelplineRiskSubject,
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
import { HELPLINE_DEFAULT_SETTINGS } from '../constants/helpline-settings.defaults';
import { HelplineSettings } from '../type/helpline.types';
import { HelplineAlertService } from './helpline-alert.service';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineContentCipher } from './helpline-content-cipher.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineRiskKeywordService } from './helpline-risk-keyword.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

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
    private readonly alerts: HelplineAlertService,
    private readonly settings: HelplineSettingsService,
    private readonly tenants: HelplineTenantService,
    private readonly notify: HelplineNotifyService,
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
      HELPLINE_RISK_MESSAGE_COPY[flag.source][flag.level],
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

    // HIGH side effects run BEFORE the RISK_FLAGGED emit, so the listener's
    // banner carries the truth about resources and supervisors from the start
    // (`resourcesSent`, `supervisorsAlerted`) instead of assuming it. Every
    // step is fast; push and Slack are detached inside the alert service.
    if (flag.level === HelplineRiskFlagLevel.HIGH) {
      await this.onHighRisk(chat, flag);
    }

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
    return flag;
  }

  /**
   * HIGH-risk side effects beyond the flag itself (contract §9.3), each
   * isolated so one failing cannot stop the other:
   *
   *  1. the org's emergency resources, in the talker's language (English,
   *     then the platform default, as fallbacks), as a talker-visible SYSTEM
   *     `RESOURCES` message — ONCE per chat (`resources_sent_at`, claimed by a
   *     conditional UPDATE), waiting room included;
   *  2. the supervisor alert (HelplineAlertService: deduped 1 per chat per
   *     10 min, never the text), whose reach is stored on the flag as
   *     `supervisors_alerted` so the banner never claims an alert that did not
   *     happen.
   *
   * Mutates `flag.resourcesSent` / `flag.supervisorsAlerted` for the caller's
   * DTO. Never throws.
   */
  async onHighRisk(chat: HelplineChat, flag: HelplineRiskFlag): Promise<void> {
    try {
      if (await this.sendResources(chat, flag)) flag.resourcesSent = true;
    } catch (error) {
      this.logger.error(
        `Emergency resources failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }
    let alerted = 0;
    try {
      const result = await this.alerts.riskHigh(
        chat,
        flag.source,
        chat.resourcesSentAt != null,
      );
      alerted = result.recipients;
    } catch (error) {
      this.logger.error(
        `Supervisor alert failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }
    flag.supervisorsAlerted = alerted;
    await this.flags
      .update(
        { id: flag.id, tenantId: chat.tenantId },
        { supervisorsAlerted: alerted, resourcesSent: flag.resourcesSent },
      )
      .catch((error) =>
        this.logger.error(
          `Could not record the alert on flag ${flag.id}: ${(error as Error).message}`,
        ),
      );
  }

  /** Step 1 of `onHighRisk`. True when THIS call sent them. */
  private async sendResources(
    chat: HelplineChat,
    flag: HelplineRiskFlag,
  ): Promise<boolean> {
    const tenant = await this.tenants.resolve(chat.tenantId);
    const settings = tenant
      ? await this.settings.getSettings(tenant)
      : this.settings.defaults;
    const text = emergencyResourcesText(settings, chat.language);
    if (!text) return false;
    // The conditional UPDATE is the once-per-chat guarantee across replicas.
    if (!(await this.chats.markResourcesSent(chat.tenantId, chat.id))) {
      return false;
    }
    chat.resourcesSentAt = new Date();
    await this.writer.system(chat, HelplineGuestSystemKind.RESOURCES, text, {
      visibleToTalker: true,
    });
    await this.events.record(
      chat.tenantId,
      chat.id,
      HelplineChatEventType.RESOURCES_SENT,
      null,
      { flagId: flag.id, language: chat.language },
    );
    helplineAudit('HELPLINE_RESOURCES_SENT', chat.tenantId, {
      chatId: chat.id,
      flagId: flag.id,
      language: chat.language,
    });
    await this.notify.chatUpdated(chat);
    return true;
  }

  /** Every flag already raised on one message (classifier dedupe). */
  flagsForMessage(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
    messageId: number,
  ): Promise<HelplineRiskFlag[]> {
    return this.flags.find({
      where: { tenantId: chat.tenantId, chatId: chat.id, messageId },
    });
  }

  /** Subject of the chat's latest flag that has one (the classifier's). */
  async latestSubject(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
  ): Promise<HelplineRiskSubject | null> {
    const flag = await this.flags.findOne({
      where: {
        tenantId: chat.tenantId,
        chatId: chat.id,
        subject: Not(IsNull()),
      },
      order: { createdAt: 'DESC' },
    });
    return flag?.subject ?? null;
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

/**
 * The org's emergency resources for a talker's language: that language, then
 * the org's English, then the platform default English. A wrong number in a
 * translation is worse than English, so nothing is machine-translated.
 */
export function emergencyResourcesText(
  settings: Pick<HelplineSettings, 'emergencyResources'>,
  language: string,
): string | null {
  const pick = (record: Record<string, string> | undefined, key: string) => {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  return (
    pick(settings.emergencyResources, language) ??
    pick(settings.emergencyResources, 'en') ??
    pick(HELPLINE_DEFAULT_SETTINGS.emergencyResources, 'en')
  );
}
