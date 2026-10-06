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
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
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
    private readonly messages: HelplineMessageRepository,
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
   * Record one risk HIT from any source — the keyword screen and the
   * classifier both come through here (contract §9.3, "fold until
   * acknowledged"):
   *
   *  - the chat has no open (unacknowledged) flag → a FRESH flag, the staff
   *    `RISK_FLAGGED`, and for HIGH the side effects (`onHighRisk`);
   *  - it has one → the hit FOLDS into it (`hit_count + 1`, the latest
   *    message and its signal offsets, max confidence, latest subject) and
   *    staff get `RISK_FLAG_UPDATED`, never a second banner; a hit above the
   *    open flag's level (ELEVATED open, HIGH arrives) UPGRADES it and runs
   *    `onHighRisk`; same-or-lower is silent (no alert, no resources);
   *  - a second hit on the SAME message (keyword then classifier) is still one
   *    hit: it can upgrade the level, never the count.
   *
   * After a listener acknowledges the flag, the next hit opens a fresh one
   * (re-escalation). Every counted hit writes a staff-only RISK marker on its
   * message (`metadata.flagId`, `folded`), so the transcript shows where.
   *
   * The open-flag lookup and the write run under a per-chat advisory lock, so
   * two hits racing on different replicas cannot both open a flag.
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
    const markers = await this.hitsForMessage(chat, message.id);
    const { flag, kind } = await this.recordHit(chat, message, input, markers);
    if (kind === 'IGNORED') return flag;

    if (kind !== 'SAME_MESSAGE_UPGRADE') {
      await this.writer.staffOnly(
        chat,
        HelplineMessageType.RISK,
        HELPLINE_RISK_MESSAGE_COPY[input.source][input.level],
        {
          flagId: flag.id,
          level: input.level,
          source: input.source,
          confidence: input.confidence,
          subject: input.subject,
          folded: kind !== 'NEW',
        },
        { parentMessageId: message.id },
      );
    }

    const raised = await this.chats.raiseRisk(
      chat.tenantId,
      chat.id,
      flag.level,
    );
    if (raised) {
      chat.riskLevel = raised.riskLevel;
      chat.priority = raised.priority;
    }

    const upgraded = kind === 'UPGRADED' || kind === 'SAME_MESSAGE_UPGRADE';
    // The timeline records a flag opening or rising, not every folded hit
    // (those are the RISK markers in the transcript).
    if (kind === 'NEW' || upgraded) {
      await this.events.record(
        chat.tenantId,
        chat.id,
        HelplineChatEventType.RISK_FLAGGED,
        null,
        {
          flagId: flag.id,
          level: flag.level,
          source: input.source,
          ...(upgraded ? { upgraded: true } : {}),
        },
      );
    }

    // HIGH side effects run BEFORE the emit, so the banner carries the truth
    // about resources and supervisors (`resourcesSent`, `supervisorsAlerted`)
    // from the start. Only a NEW HIGH flag or an upgrade to HIGH runs them; a
    // folded same-or-lower hit never re-alerts.
    if (
      flag.level === HelplineRiskFlagLevel.HIGH &&
      (kind === 'NEW' || upgraded)
    ) {
      await this.onHighRisk(chat, flag);
    }

    const messages = new Map<number, HelplineMessage>([[message.id, message]]);
    if (flag.messageId !== message.id) {
      const opener = await this.messages.findById(
        chat.tenantId,
        chat.id,
        flag.messageId,
      );
      if (opener) messages.set(opener.id, opener);
    }
    const dto = this.views.riskFlagDto(flag, messages);
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      kind === 'NEW'
        ? HelplineServerEvents.RISK_FLAGGED
        : HelplineServerEvents.RISK_FLAG_UPDATED,
      { chatId: chat.id, flag: dto },
    );
    if (chat.status === HelplineChatStatus.WAITING) {
      this.queue.queueChanged(chat.tenantId);
    }

    // The audit logger is the one sink allowed the matched text (invariant 5):
    // every counted hit, folded or not, with its own signal.
    helplineAudit('HELPLINE_RISK_FLAGGED', chat.tenantId, {
      chatId: chat.id,
      flagId: flag.id,
      level: input.level,
      source: input.source,
      folded: kind !== 'NEW',
      hitCount: flag.hitCount,
      signal:
        input.signalStart != null && input.signalEnd != null
          ? message.content.slice(input.signalStart, input.signalEnd) || null
          : null,
    });
    return flag;
  }

  /**
   * The fold itself, under a per-chat transaction-scoped advisory lock:
   * find the open flag; open a fresh one, fold into it, or (same message)
   * upgrade it in place. Returns what happened.
   */
  private async recordHit(
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
    markers: { flagId: string | null }[],
  ): Promise<{ flag: HelplineRiskFlag; kind: FoldKind }> {
    return this.flags.manager.transaction(async (em) => {
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `helpline-risk:${chat.id}`,
      ]);
      const repo = em.getRepository(HelplineRiskFlag);
      const open = await repo.findOne({
        where: {
          tenantId: chat.tenantId,
          chatId: chat.id,
          acknowledgedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
      const now = new Date();

      if (!open) {
        const flag = await repo.save(
          repo.create({
            tenantId: chat.tenantId,
            chatId: chat.id,
            messageId: message.id,
            ...input,
            outcome: HelplineRiskOutcome.UNREVIEWED,
            hitCount: 1,
            lastHitAt: now,
            latestMessageId: message.id,
            latestSignalStart: input.signalStart,
            latestSignalEnd: input.signalEnd,
          }),
        );
        return { flag, kind: 'NEW' as const };
      }

      const decision = foldDecision(
        open,
        input.level,
        markers.some((m) => m.flagId === open.id),
      );
      if (decision === 'IGNORED') return { flag: open, kind: decision };

      open.confidence = maxConfidence(open.confidence, input.confidence);
      if (input.subject) open.subject = input.subject;
      if (decision === 'UPGRADED' || decision === 'SAME_MESSAGE_UPGRADE') {
        open.level = input.level;
      }
      if (decision === 'FOLDED' || decision === 'UPGRADED') {
        open.hitCount = (open.hitCount ?? 1) + 1;
        open.lastHitAt = now;
        open.latestMessageId = message.id;
        open.latestSignalStart = input.signalStart;
        open.latestSignalEnd = input.signalEnd;
      }
      const flag = await repo.save(open);
      return { flag, kind: decision };
    });
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

  /**
   * The hits already counted on one message — its RISK markers — with the
   * flag each went to and its own source and level. What the classifier
   * dedupes against: a flag row no longer says which messages folded into it.
   */
  async hitsForMessage(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
    messageId: number,
  ): Promise<
    {
      flagId: string | null;
      source: HelplineRiskSource;
      level: HelplineRiskFlagLevel;
    }[]
  > {
    const markers = await this.messages.listRiskMarkers(
      chat.tenantId,
      chat.id,
      messageId,
    );
    return markers
      .map((m) => m.metadata ?? {})
      .filter(
        (meta) =>
          (meta.source === HelplineRiskSource.KEYWORD ||
            meta.source === HelplineRiskSource.CLASSIFIER) &&
          (meta.level === HelplineRiskFlagLevel.HIGH ||
            meta.level === HelplineRiskFlagLevel.ELEVATED),
      )
      .map((meta) => ({
        flagId: typeof meta.flagId === 'string' ? meta.flagId : null,
        source: meta.source as HelplineRiskSource,
        level: meta.level as HelplineRiskFlagLevel,
      }));
  }

  /** Subject of the chat's latest flag that has one (the classifier's). */
  async latestSubject(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
  ): Promise<HelplineRiskSubject | null> {
    // updatedAt, not createdAt: a folded hit updates the open flag's subject.
    const flag = await this.flags.findOne({
      where: {
        tenantId: chat.tenantId,
        chatId: chat.id,
        subject: Not(IsNull()),
      },
      order: { updatedAt: 'DESC' },
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

/**
 * What a hit does to the chat's open flag. `sameMessage`: this message
 * already counted a hit on it (keyword, then the classifier).
 *
 *  - higher level, new message  → UPGRADED (counts a hit, runs the HIGH effects)
 *  - higher level, same message → SAME_MESSAGE_UPGRADE (level only)
 *  - same or lower, new message → FOLDED (counts a hit, silent)
 *  - same or lower, same message → IGNORED
 */
export type FoldKind =
  | 'NEW'
  | 'FOLDED'
  | 'UPGRADED'
  | 'SAME_MESSAGE_UPGRADE'
  | 'IGNORED';

const LEVEL_RANK: Record<HelplineRiskFlagLevel, number> = {
  [HelplineRiskFlagLevel.ELEVATED]: 1,
  [HelplineRiskFlagLevel.HIGH]: 2,
};

export function foldDecision(
  open: Pick<HelplineRiskFlag, 'level'>,
  level: HelplineRiskFlagLevel,
  sameMessage: boolean,
): Exclude<FoldKind, 'NEW'> {
  const higher = LEVEL_RANK[level] > LEVEL_RANK[open.level];
  if (sameMessage) return higher ? 'SAME_MESSAGE_UPGRADE' : 'IGNORED';
  return higher ? 'UPGRADED' : 'FOLDED';
}

function maxConfidence(
  a: number | null | undefined,
  b: number | null | undefined,
): number | null {
  const values = [a, b].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return values.length ? Math.max(...values) : null;
}
