import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  HELPLINE_LIMITS,
  HelplineAccess,
  HelplineChatStatus,
  HelplineSenderRole,
  HelplineSummaryKind,
} from '../constants/helpline.constants';
import { HelplineChatSummary } from '../entity/helpline-chat-summary.entity';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineRiskFlag } from '../entity/helpline-risk-flag.entity';
import { HelplineTalkerFeedback } from '../entity/helpline-talker-feedback.entity';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import {
  ChatDetailDto,
  ChatListItemDto,
  GuestChatDto,
  LobbyEntryDto,
  RiskFlagDto,
  StaffChatDto,
  StaffMessageDto,
  SummaryDto,
} from '../type/helpline.types';
import { copilotStatusFor, latestStage } from '../util/helpline-copilot.util';
import { toStaffMessageDto } from '../util/helpline-serializers';
import {
  HelplineContentCipher,
  decryptTalker,
} from './helpline-content-cipher.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

const iso = (d: Date | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

const latest = (...dates: (Date | null)[]): string | null => {
  const times = dates
    .filter((d): d is Date => !!d)
    .map((d) => new Date(d).getTime());
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
};

/**
 * Re-derive a flag's live `signal` from the message body by offset (contract
 * §5.5 RiskFlagDto). Null once the body is erased — the DB never stored it.
 */
export function deriveSignal(
  flag: Pick<HelplineRiskFlag, 'signalStart' | 'signalEnd'>,
  message: Pick<HelplineMessage, 'content' | 'erasedAt'> | null | undefined,
): string | null {
  if (!message || message.erasedAt) return null;
  if (flag.signalStart == null || flag.signalEnd == null) return null;
  const text = message.content.slice(flag.signalStart, flag.signalEnd);
  return text || null;
}

/**
 * Builds every chat-shaped DTO in the contract (§5.2, §5.5). Read-only; all
 * loads are tenant-scoped.
 */
@Injectable()
export class HelplineChatViewService {
  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    @InjectRepository(HelplineRiskFlag)
    private readonly flags: Repository<HelplineRiskFlag>,
    @InjectRepository(HelplineChatSummary)
    private readonly summaries: Repository<HelplineChatSummary>,
    @InjectRepository(HelplineTalkerFeedback)
    private readonly feedback: Repository<HelplineTalkerFeedback>,
    private readonly tenants: HelplineTenantService,
    private readonly settings: HelplineSettingsService,
    private readonly profiles: HelplineProfileService,
    private readonly presence: HelplinePresenceService,
    private readonly events: HelplineEventService,
    private readonly cipher: HelplineContentCipher,
  ) {}

  /** The talker with `displayName` decrypted (it is encrypted at rest). */
  async findTalker(
    tenantId: string,
    talkerId: string,
  ): Promise<HelplineTalker | null> {
    const talker = await this.talkers.findOne({
      where: { id: talkerId, tenantId },
    });
    return talker ? decryptTalker(this.cipher, talker) : null;
  }

  async talkersById(
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, HelplineTalker>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.talkers.find({
      where: { tenantId, id: In(unique) },
    });
    await Promise.all(rows.map((t) => decryptTalker(this.cipher, t)));
    return new Map(rows.map((t) => [t.id, t]));
  }

  // ── Guest ────────────────────────────────────────────────────────────────

  async guestChat(
    chat: HelplineChat,
    talker?: HelplineTalker | null,
  ): Promise<GuestChatDto> {
    const [tenant, resolvedTalker, feedback, position, listenerName] =
      await Promise.all([
        this.tenants.resolve(chat.tenantId),
        talker
          ? Promise.resolve(talker)
          : this.findTalker(chat.tenantId, chat.talkerId),
        this.feedback.count({
          where: { tenantId: chat.tenantId, chatId: chat.id },
        }),
        chat.status === HelplineChatStatus.WAITING
          ? this.chats.queuePosition(chat.tenantId, chat)
          : Promise.resolve(null),
        chat.listenerId != null
          ? this.profiles
              .aliases(chat.tenantId, [chat.listenerId])
              .then((m) => m.get(chat.listenerId as number) ?? null)
          : Promise.resolve(null),
      ]);
    return {
      id: chat.id,
      status: chat.status,
      endedReason: chat.endedReason,
      language: chat.language,
      displayName:
        resolvedTalker?.displayName ?? HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME,
      listenerName,
      queuePosition: position,
      waitStartedAt: new Date(chat.waitStartedAt).toISOString(),
      claimedAt: iso(chat.claimedAt),
      endedAt: iso(chat.endedAt),
      feedbackSubmitted: feedback > 0,
      org: { name: tenant?.name ?? '', logoUrl: tenant?.logoUrl ?? null },
    };
  }

  // ── Staff ────────────────────────────────────────────────────────────────

  async staffChat(
    chat: HelplineChat,
    access: HelplineAccess,
    talker?: HelplineTalker | null,
  ): Promise<StaffChatDto> {
    const [resolvedTalker, listenerName, talkerConnected, listenerConnected] =
      await Promise.all([
        talker
          ? Promise.resolve(talker)
          : this.findTalker(chat.tenantId, chat.talkerId),
        chat.listenerId != null
          ? this.profiles
              .aliases(chat.tenantId, [chat.listenerId])
              .then((m) => m.get(chat.listenerId as number) ?? null)
          : Promise.resolve(null),
        this.presence.isConnected('talker', chat.talkerId),
        chat.listenerId != null
          ? this.presence.isConnected('listener', chat.listenerId)
          : Promise.resolve(false),
      ]);
    return {
      id: chat.id,
      status: chat.status,
      channel: chat.channel,
      talker: {
        id: chat.talkerId,
        displayName:
          resolvedTalker?.displayName ?? HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME,
        language: resolvedTalker?.language ?? chat.language,
        consentVersion: resolvedTalker?.consentVersion ?? '',
        connected: talkerConnected,
        blocked: resolvedTalker?.blockedAt != null,
      },
      listener:
        chat.listenerId != null
          ? { id: chat.listenerId, displayName: listenerName ?? '' }
          : null,
      myAccess: access,
      priority: chat.priority,
      riskLevel: chat.riskLevel,
      waitStartedAt: new Date(chat.waitStartedAt).toISOString(),
      claimedAt: iso(chat.claimedAt),
      endedAt: iso(chat.endedAt),
      endedReason: chat.endedReason,
      lastTalkerMessageAt: iso(chat.lastTalkerMessageAt),
      lastListenerMessageAt: iso(chat.lastListenerMessageAt),
      transferPending: chat.transferRequestedAt != null,
      resourcesSentAt: iso(chat.resourcesSentAt),
      listenerConnected,
      erased: chat.erasedAt != null,
    };
  }

  /** Staff DTOs with sender names resolved in one pass. */
  async staffMessages(
    chat: HelplineChat,
    rows: HelplineMessage[],
    talker?: HelplineTalker | null,
  ): Promise<StaffMessageDto[]> {
    const names = await this.profiles.aliases(
      chat.tenantId,
      rows.map((m) => m.senderUserId).filter((id): id is number => id != null),
    );
    const talkerName = talker?.displayName ?? null;
    return rows.map((m) =>
      toStaffMessageDto(
        m,
        m.senderRole === HelplineSenderRole.TALKER
          ? talkerName
          : m.senderUserId != null
            ? (names.get(m.senderUserId) ?? null)
            : null,
      ),
    );
  }

  async riskFlags(
    chat: HelplineChat,
    rows?: HelplineRiskFlag[],
  ): Promise<RiskFlagDto[]> {
    const flags =
      rows ??
      (await this.flags.find({
        where: { tenantId: chat.tenantId, chatId: chat.id },
        order: { createdAt: 'ASC' },
      }));
    if (!flags.length) return [];
    // The opener's message and, for a folded flag, the latest hit's.
    const ids = new Set<number>();
    for (const f of flags) {
      ids.add(f.messageId);
      if (f.latestMessageId != null) ids.add(f.latestMessageId);
    }
    const messageRows = await Promise.all(
      [...ids].map((id) => this.messages.findById(chat.tenantId, chat.id, id)),
    );
    const byId = new Map(
      messageRows
        .filter((m): m is HelplineMessage => !!m)
        .map((m) => [m.id, m]),
    );
    const ackNames = await this.profiles.aliases(
      chat.tenantId,
      flags
        .map((f) => f.acknowledgedBy)
        .filter((id): id is number => id != null),
    );
    const readable = await this.decryptNotes(flags);
    return readable.map((flag) => this.riskFlagDto(flag, byId, ackNames));
  }

  /** Copies of the flags with `outcomeNote` decrypted (encrypted at rest). */
  async decryptNotes(flags: HelplineRiskFlag[]): Promise<HelplineRiskFlag[]> {
    return Promise.all(
      flags.map(async (flag) =>
        flag.outcomeNote == null
          ? flag
          : Object.assign(Object.create(Object.getPrototypeOf(flag)), flag, {
              outcomeNote: await this.cipher.decrypt(
                flag.outcomeNote,
                'helpline_risk_flags.outcome_note',
              ),
            }),
      ),
    );
  }

  /**
   * `messages`: the flag's message(s) — a map by id, or the one message the
   * caller holds (used for whichever of the opener / latest hit it is). Both
   * signals are re-derived from (decrypted) bodies by offset.
   */
  riskFlagDto(
    flag: HelplineRiskFlag,
    messages: Map<number, HelplineMessage> | HelplineMessage | null | undefined,
    ackNames: Map<number, string> = new Map(),
  ): RiskFlagDto {
    const lookup = (id: number | null | undefined) => {
      if (id == null || !messages) return undefined;
      if (messages instanceof Map) return messages.get(id);
      return messages.id === id ? messages : undefined;
    };
    const latestId = flag.latestMessageId ?? flag.messageId;
    const latestSignal =
      flag.latestMessageId == null
        ? deriveSignal(flag, lookup(flag.messageId))
        : deriveSignal(
            {
              signalStart: flag.latestSignalStart,
              signalEnd: flag.latestSignalEnd,
            },
            lookup(latestId),
          );
    return {
      id: flag.id,
      messageId: flag.messageId,
      level: flag.level,
      source: flag.source,
      confidence: flag.confidence,
      subject: flag.subject,
      signal: deriveSignal(flag, lookup(flag.messageId)),
      resourcesSent: flag.resourcesSent,
      supervisorsAlerted: flag.supervisorsAlerted ?? null,
      hitCount: flag.hitCount ?? 1,
      lastHitAt: new Date(flag.lastHitAt ?? flag.createdAt).toISOString(),
      latestSignal,
      acknowledgedAt: iso(flag.acknowledgedAt),
      acknowledgedByName:
        flag.acknowledgedBy != null
          ? (ackNames.get(flag.acknowledgedBy) ?? null)
          : null,
      outcome: flag.outcome,
      outcomeNote: flag.outcomeNote,
      createdAt: new Date(flag.createdAt).toISOString(),
    };
  }

  async summaryDto(row: HelplineChatSummary): Promise<SummaryDto> {
    const editedByName =
      row.editedBy != null
        ? ((await this.profiles.aliases(row.tenantId, [row.editedBy])).get(
            row.editedBy,
          ) ?? null)
        : null;
    return {
      kind: row.kind,
      fields: await this.cipher.decryptFields(row.fields),
      throughMessageId: row.throughMessageId,
      editedByName,
      version: row.version,
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  async chatDetail(
    chat: HelplineChat,
    access: HelplineAccess,
  ): Promise<ChatDetailDto> {
    const [talker, rows, summaryRows, eventRows, tenant] = await Promise.all([
      this.findTalker(chat.tenantId, chat.talkerId),
      this.messages.listForChat(chat.tenantId, chat.id),
      this.summaries.find({
        where: { tenantId: chat.tenantId, chatId: chat.id },
      }),
      this.events.listForChat(chat.tenantId, chat.id),
      this.tenants.resolve(chat.tenantId),
    ]);
    const settings = tenant
      ? await this.settings.getSettings(tenant)
      : this.settings.defaults;

    const summaryOf = async (kind: HelplineSummaryKind) => {
      const row = summaryRows.find((s) => s.kind === kind);
      return row ? this.summaryDto(row) : null;
    };
    const actorNames = await this.profiles.aliases(
      chat.tenantId,
      eventRows
        .map((e) => e.actorUserId)
        .filter((id): id is number => id != null),
    );

    return {
      chat: await this.staffChat(chat, access, talker),
      messages: await this.staffMessages(chat, rows, talker),
      riskFlags: await this.riskFlags(chat),
      summaries: {
        rolling: await summaryOf(HelplineSummaryKind.ROLLING),
        handoff: await summaryOf(HelplineSummaryKind.HANDOFF),
        final: await summaryOf(HelplineSummaryKind.FINAL),
      },
      // Status from the last copilot outcome (Redis), stage from the newest
      // STAGE row already loaded. Read here rather than through
      // HelplineCopilotService, which depends on this service.
      copilot: {
        status: copilotStatusFor(
          settings,
          await this.presence.getCopilotStatus(chat.id).catch(() => null),
        ),
        stage: latestStage(rows),
      },
      events: eventRows.map((e) => ({
        type: e.type,
        at: new Date(e.createdAt).toISOString(),
        actorName:
          e.actorUserId != null
            ? (actorNames.get(e.actorUserId) ?? null)
            : null,
      })),
    };
  }

  async chatListItems(
    tenantId: string,
    chats: HelplineChat[],
  ): Promise<ChatListItemDto[]> {
    const [talkers, names] = await Promise.all([
      this.talkersById(
        tenantId,
        chats.map((c) => c.talkerId),
      ),
      this.profiles.aliases(
        tenantId,
        chats.map((c) => c.listenerId).filter((id): id is number => id != null),
      ),
    ]);
    return chats.map((chat) => ({
      id: chat.id,
      status: chat.status,
      talkerName:
        talkers.get(chat.talkerId)?.displayName ??
        HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME,
      language: chat.language,
      listener:
        chat.listenerId != null
          ? {
              id: chat.listenerId,
              displayName: names.get(chat.listenerId) ?? '',
            }
          : null,
      riskLevel: chat.riskLevel,
      waitStartedAt: new Date(chat.waitStartedAt).toISOString(),
      claimedAt: iso(chat.claimedAt),
      endedAt: iso(chat.endedAt),
      endedReason: chat.endedReason,
      lastMessageAt: latest(
        chat.lastTalkerMessageAt,
        chat.lastListenerMessageAt,
      ),
      messageCount: chat.talkerMessageCount + chat.listenerMessageCount,
      erased: chat.erasedAt != null,
    }));
  }

  async lobbyEntries(
    tenantId: string,
    queue: HelplineChat[],
  ): Promise<LobbyEntryDto[]> {
    const [talkers, previews, names] = await Promise.all([
      this.talkersById(
        tenantId,
        queue.map((c) => c.talkerId),
      ),
      this.messages.firstTalkerTexts(
        tenantId,
        queue.map((c) => c.id),
      ),
      this.profiles.aliases(
        tenantId,
        queue.map((c) => c.listenerId).filter((id): id is number => id != null),
      ),
    ]);
    return queue.map((chat) => {
      const isTransfer = chat.status === HelplineChatStatus.ACTIVE;
      const preview = previews.get(chat.id)?.content ?? null;
      return {
        chatId: chat.id,
        kind: isTransfer ? 'TRANSFER' : 'NEW',
        displayName:
          talkers.get(chat.talkerId)?.displayName ??
          HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME,
        language: chat.language,
        waitStartedAt: new Date(chat.waitStartedAt).toISOString(),
        priority: chat.priority,
        riskLevel: chat.riskLevel,
        preview: preview
          ? preview.slice(0, HELPLINE_LIMITS.LOBBY_PREVIEW_CHARS)
          : null,
        transferFromName:
          isTransfer && chat.listenerId != null
            ? (names.get(chat.listenerId) ?? null)
            : null,
        targetListenerId: chat.transferTargetListenerId,
      };
    });
  }
}
