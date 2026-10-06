import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThanOrEqual, Repository } from 'typeorm';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  HelplineChatStatus,
  HelplinePresence,
  HelplineRiskFlagLevel,
  HelplineRiskLevel,
  HelplineRiskOutcome,
  HelplineRiskSource,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineRiskFlag } from '../entity/helpline-risk-flag.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import {
  HelplineStaffUser,
  HelplineTenant,
  MonitorActiveChatDto,
  MonitorDto,
  RiskCalibrationDto,
  RiskOutcomeCounts,
} from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineStaffDirectoryService } from './helpline-staff-directory.service';

export const CALIBRATION_LIMITS = {
  DEFAULT_DAYS: 7,
  MAX_DAYS: 90,
  MAX_ITEMS: 200,
} as const;

/** Classifier confidence bands for the calibration view. */
export const CONFIDENCE_BANDS: readonly [number, number][] = [
  [0, 0.5],
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0001],
];

const RISK_RANK: Record<HelplineRiskLevel, number> = {
  [HelplineRiskLevel.HIGH]: 2,
  [HelplineRiskLevel.ELEVATED]: 1,
  [HelplineRiskLevel.NONE]: 0,
};

const zeroCounts = (): RiskOutcomeCounts => ({
  [HelplineRiskOutcome.UNREVIEWED]: 0,
  [HelplineRiskOutcome.CONFIRMED]: 0,
  [HelplineRiskOutcome.FALSE_POSITIVE]: 0,
});

/** Pure: the calibration aggregates over a window's flags. */
export function calibrationAggregates(
  flags: Pick<HelplineRiskFlag, 'source' | 'outcome' | 'confidence'>[],
): Pick<RiskCalibrationDto, 'counts' | 'bySource' | 'classifierByConfidence'> {
  const counts = zeroCounts();
  const bySource = {
    [HelplineRiskSource.KEYWORD]: { ...zeroCounts(), total: 0 },
    [HelplineRiskSource.CLASSIFIER]: { ...zeroCounts(), total: 0 },
  };
  const bands = CONFIDENCE_BANDS.map(([from, to]) => ({
    from,
    to: Math.min(to, 1),
    ...zeroCounts(),
  }));
  for (const flag of flags) {
    counts[flag.outcome] += 1;
    const source = bySource[flag.source];
    if (source) {
      source[flag.outcome] += 1;
      source.total += 1;
    }
    if (
      flag.source === HelplineRiskSource.CLASSIFIER &&
      flag.confidence != null
    ) {
      const i = CONFIDENCE_BANDS.findIndex(
        ([from, to]) => flag.confidence! >= from && flag.confidence! < to,
      );
      if (i >= 0) bands[i][flag.outcome] += 1;
    }
  }
  return { counts, bySource, classifierByConfidence: bands };
}

/** Pure: seconds since the chat's last message, or null if there was none. */
export function lastMessageAgeSeconds(
  chat: Pick<HelplineChat, 'lastTalkerMessageAt' | 'lastListenerMessageAt'>,
  now: Date,
): number | null {
  const times = [chat.lastTalkerMessageAt, chat.lastListenerMessageAt]
    .filter((d): d is Date => d != null)
    .map((d) => new Date(d).getTime());
  if (!times.length) return null;
  return Math.max(0, Math.round((now.getTime() - Math.max(...times)) / 1000));
}

/**
 * The supervisor views (contract §5.3, `view:helpline:monitor`): the live
 * monitor and the risk-flag calibration view. Everything is read with the
 * caller's tenant in the WHERE clause; nothing here writes.
 */
@Injectable()
export class HelplineMonitorService {
  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    @InjectRepository(HelplineRiskFlag)
    private readonly flags: Repository<HelplineRiskFlag>,
    private readonly queue: HelplineQueueService,
    private readonly views: HelplineChatViewService,
    private readonly presence: HelplinePresenceService,
    private readonly profiles: HelplineProfileService,
    private readonly directory: HelplineStaffDirectoryService,
    private readonly settings: HelplineSettingsService,
  ) {}

  async monitor(tenant: HelplineTenant, now = new Date()): Promise<MonitorDto> {
    const settings = await this.settings.getSettings(tenant);
    const [{ waiting, counts }, active, roster, presence] = await Promise.all([
      this.queue.buildQueue(tenant.id),
      this.chats.listActive(tenant.id),
      this.directory.usersWithPermission(
        tenant,
        PERMISSIONS.VIEW_HELPLINE_LOBBY,
      ),
      this.presence.listPresence(tenant.id),
    ]);

    const openChatIds = [
      ...active.map((c) => c.id),
      ...waiting.filter((w) => w.kind === 'NEW').map((w) => w.chatId),
    ];
    const unacked = openChatIds.length
      ? await this.flags.find({
          where: {
            tenantId: tenant.id,
            chatId: In(openChatIds),
            acknowledgedAt: IsNull(),
          },
          select: ['chatId', 'level'],
        })
      : [];
    const openFlagsByChat = new Map<string, number>();
    for (const flag of unacked) {
      openFlagsByChat.set(
        flag.chatId,
        (openFlagsByChat.get(flag.chatId) ?? 0) + 1,
      );
    }

    const [items, talkerLive, listenerLive] = await Promise.all([
      this.views.chatListItems(tenant.id, active),
      this.presence.connectedMany(
        'talker',
        active.map((c) => c.talkerId),
      ),
      this.presence.connectedMany(
        'listener',
        active
          .map((c) => c.listenerId)
          .filter((id): id is number => id != null),
      ),
    ]);
    const byId = new Map(active.map((c) => [c.id, c]));
    const activeChats: MonitorActiveChatDto[] = items
      .map((item) => {
        const chat = byId.get(item.id) as HelplineChat;
        return {
          ...item,
          lastMessageAgeSeconds: lastMessageAgeSeconds(chat, now),
          listenerConnected:
            chat.listenerId != null &&
            listenerLive.get(chat.listenerId) === true,
          talkerConnected: talkerLive.get(chat.talkerId) === true,
          transferPending: chat.transferRequestedAt != null,
          openFlags: openFlagsByChat.get(chat.id) ?? 0,
        };
      })
      // What needs a supervisor first: risk, then the longest silence.
      .sort(
        (a, b) =>
          RISK_RANK[b.riskLevel] - RISK_RANK[a.riskLevel] ||
          (b.lastMessageAgeSeconds ?? -1) - (a.lastMessageAgeSeconds ?? -1),
      );

    const presenceById = new Map(presence.map((p) => [p.userId, p.presence]));
    const activeCount = new Map<number, number>();
    for (const chat of active) {
      if (chat.listenerId == null) continue;
      activeCount.set(
        chat.listenerId,
        (activeCount.get(chat.listenerId) ?? 0) + 1,
      );
    }
    const profiles = await this.profiles.getProfiles(
      tenant.id,
      roster,
      settings.orgMaxConcurrentPerListener,
    );
    const listeners = roster.map((user) => {
      const profile = profiles.get(user.id);
      return {
        userId: user.id,
        displayName: profile?.displayName ?? '',
        presence: presenceById.get(user.id) ?? HelplinePresence.OFFLINE,
        activeChatCount: activeCount.get(user.id) ?? 0,
        maxConcurrentChats: profile?.maxConcurrentChats ?? 0,
        languages: profile?.languages ?? [],
      };
    });

    return {
      tiles: {
        waiting: counts.waiting,
        active: counts.active,
        listenersAvailable: counts.listenersAvailable,
        openHighFlags: unacked.filter(
          (f) => f.level === HelplineRiskFlagLevel.HIGH,
        ).length,
      },
      activeChats,
      waiting,
      listeners,
    };
  }

  /**
   * GET /risk-flags: the last `days` of flags with their outcomes, so
   * supervisors can see where the classifier is wrong and tune
   * `riskHighConfidence`. Items carry the live `signal` (re-derived from the
   * decrypted body; null once erased) — which makes this a transcript read,
   * audited as one.
   */
  async calibration(
    tenant: HelplineTenant,
    user: HelplineStaffUser,
    query: { outcome?: string; days?: number },
    now = new Date(),
  ): Promise<RiskCalibrationDto> {
    const days = Math.min(
      Math.max(
        1,
        Math.floor(Number(query.days) || CALIBRATION_LIMITS.DEFAULT_DAYS),
      ),
      CALIBRATION_LIMITS.MAX_DAYS,
    );
    const since = new Date(now.getTime() - days * 86_400_000);
    const outcome = (Object.values(HelplineRiskOutcome) as string[]).includes(
      query.outcome ?? '',
    )
      ? (query.outcome as HelplineRiskOutcome)
      : undefined;

    const [window, settings] = await Promise.all([
      this.flags.find({
        where: { tenantId: tenant.id, createdAt: MoreThanOrEqual(since) },
        select: ['id', 'source', 'outcome', 'confidence'],
      }),
      this.settings.getSettings(tenant),
    ]);
    const rows = await this.flags.find({
      where: {
        tenantId: tenant.id,
        createdAt: MoreThanOrEqual(since),
        ...(outcome ? { outcome } : {}),
      },
      order: { createdAt: 'DESC' },
      take: CALIBRATION_LIMITS.MAX_ITEMS,
    });

    const chatIds = [...new Set(rows.map((f) => f.chatId))];
    const [chatRows, messageRows, readable] = await Promise.all([
      Promise.all(chatIds.map((id) => this.chats.findById(tenant.id, id))),
      this.messages.findByIds(
        tenant.id,
        rows.map((f) => f.messageId),
      ),
      this.views.decryptNotes(rows),
    ]);
    const chats = new Map(
      chatRows
        .filter((c): c is HelplineChat => c != null)
        .map((c) => [c.id, c]),
    );
    const messages = new Map<number, HelplineMessage>(
      messageRows.map((m) => [m.id, m]),
    );
    const names = await this.profiles.aliases(
      tenant.id,
      [
        ...rows.map((f) => f.acknowledgedBy),
        ...[...chats.values()].map((c) => c.listenerId),
      ].filter((id): id is number => id != null),
    );

    const items = readable.map((flag) => {
      const chat = chats.get(flag.chatId);
      return {
        ...this.views.riskFlagDto(flag, messages.get(flag.messageId), names),
        chatId: flag.chatId,
        chatStatus: chat?.status ?? HelplineChatStatus.ENDED,
        chatRiskLevel: chat?.riskLevel ?? HelplineRiskLevel.NONE,
        listener:
          chat?.listenerId != null
            ? {
                id: chat.listenerId,
                displayName: names.get(chat.listenerId) ?? '',
              }
            : null,
        erased: chat?.erasedAt != null,
      };
    });

    helplineAudit(
      'HELPLINE_TRANSCRIPT_ACCESSED',
      tenant.id,
      { view: 'risk-calibration', flags: items.length, days },
      user.id,
    );
    return {
      items,
      ...calibrationAggregates(window),
      riskHighConfidence: settings.riskHighConfidence,
      days,
    };
  }
}
