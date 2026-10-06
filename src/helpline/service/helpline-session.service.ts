import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { ErrorCode } from 'src/exception/error-code.enum';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_CONSENT_VERSION,
  HELPLINE_LIMITS,
  HELPLINE_TIMINGS,
  HELPLINE_WAIT_ESTIMATE,
  HelplineChannel,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineRiskLevel,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineTalker } from '../entity/helpline-talker.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import {
  GuestSessionCreatedDto,
  HelplineClosedReason,
  HelplineSettings,
  HelplineTenant,
  PublicStatusDto,
} from '../type/helpline.types';
import { helplineAudit } from '../util/helpline-audit';
import { helplineDisabled, helplineError } from '../util/helpline-errors';
import { isWithinHours } from '../util/helpline-hours';
import { toGuestMessageDtos } from '../util/helpline-serializers';
import { estimateWaitMinutes } from '../util/helpline-wait-estimate';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplineContentCipher } from './helpline-content-cipher.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineGuestTokenService } from './helpline-guest-token.service';
import {
  HelplineMessageService,
  HelplineSendRefused,
} from './helpline-message.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

export interface CreateSessionInput {
  displayName?: string;
  language?: string;
  consentVersion?: string;
  firstMessage?: string;
  ip?: string | null;
  userAgent?: string | null;
}

interface OpenState {
  open: boolean;
  closedReason: HelplineClosedReason | null;
}

/**
 * `open = enabled && withinHours && availableListeners ≥ 1 && waiting < max`
 * (contract §5.1), with `allowQueueWhenNoListeners` lifting the listener
 * condition. Reasons in the order a talker can act on them.
 */
export function computeOpenState(
  settings: HelplineSettings,
  now: Date,
  availableListeners: number,
  waiting: number,
): OpenState {
  if (!isWithinHours(settings.hours, now)) {
    return { open: false, closedReason: 'OUTSIDE_HOURS' };
  }
  if (availableListeners < 1 && !settings.allowQueueWhenNoListeners) {
    return { open: false, closedReason: 'NO_LISTENERS' };
  }
  if (waiting >= settings.maxWaitingTalkers) {
    return { open: false, closedReason: 'QUEUE_FULL' };
  }
  return { open: true, closedReason: null };
}

/**
 * The public, unauthenticated half of the helpline: status and session
 * creation. Nothing is stored about a talker before they accept consent.
 */
@Injectable()
export class HelplineSessionService {
  private readonly logger = LoggerService.getInstance(
    HelplineSessionService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(HelplineTalker)
    private readonly talkers: Repository<HelplineTalker>,
    private readonly chats: HelplineChatRepository,
    private readonly messages: HelplineMessageRepository,
    private readonly tenants: HelplineTenantService,
    private readonly settings: HelplineSettingsService,
    private readonly presence: HelplinePresenceService,
    private readonly tokens: HelplineGuestTokenService,
    private readonly events: HelplineEventService,
    private readonly views: HelplineChatViewService,
    private readonly messageService: HelplineMessageService,
    private readonly queue: HelplineQueueService,
    private readonly cipher: HelplineContentCipher,
  ) {}

  /** Unknown code and disabled org look identical: `{ enabled: false }`. */
  async status(tenantCode: string): Promise<PublicStatusDto> {
    const tenant = await this.tenants.resolve(tenantCode);
    if (!tenant) return { enabled: false };

    const cached = await this.presence
      .getCachedStatus<PublicStatusDto>(tenant.id)
      .catch(() => null);
    if (cached) return cached;

    const status = await this.computeStatus(tenant);
    await this.presence
      .setCachedStatus(tenant.id, status)
      .catch(() => undefined);
    return status;
  }

  private async computeStatus(
    tenant: HelplineTenant,
  ): Promise<PublicStatusDto> {
    if (!(await this.settings.isEnabled(tenant))) return { enabled: false };
    const settings = await this.settings.getSettings(tenant);
    const [available, waiting, waits] = await Promise.all([
      this.presence.availableListenerIds(tenant.id),
      this.chats.countWaiting(tenant.id),
      this.chats.recentClaimWaitSeconds(
        tenant.id,
        new Date(Date.now() - HELPLINE_WAIT_ESTIMATE.WINDOW_DAYS * 86_400_000),
      ),
    ]);
    const { open, closedReason } = computeOpenState(
      settings,
      new Date(),
      available.length,
      waiting,
    );
    return {
      enabled: true,
      open,
      closedReason,
      org: { name: tenant.name, logoUrl: tenant.logoUrl },
      languages: settings.languages,
      hours: settings.hours,
      estimatedWaitMinutes: estimateWaitMinutes(waits),
      resources: settings.emergencyResources,
      consent: {
        version: HELPLINE_CONSENT_VERSION,
        retentionDays: settings.retentionDays,
        ageNotice: settings.ageNotice,
      },
    };
  }

  async createSession(
    tenantCode: string,
    input: CreateSessionInput,
  ): Promise<GuestSessionCreatedDto> {
    const tenant = await this.tenants.resolve(tenantCode);
    if (!tenant || !(await this.settings.isEnabled(tenant))) {
      throw helplineDisabled();
    }
    if (input.consentVersion !== HELPLINE_CONSENT_VERSION) {
      throw helplineError(
        HttpStatus.BAD_REQUEST,
        ErrorCode.HELPLINE_CONSENT_OUTDATED,
        'The consent text has changed. Please read it again and accept to continue.',
      );
    }
    const settings = await this.settings.getSettings(tenant);
    const ipHash = this.tokens.hashIp(input.ip);

    if (ipHash && (await this.isBlocked(tenant.id, ipHash))) {
      // Neutral wording on purpose: a blocked person is told nothing that
      // invites them to work around it, and nothing that shames them.
      throw helplineError(
        HttpStatus.FORBIDDEN,
        ErrorCode.HELPLINE_TALKER_BLOCKED,
        'This chat service is not available to you right now.',
      );
    }

    const [available, waiting] = await Promise.all([
      this.presence.availableListenerIds(tenant.id),
      this.chats.countWaiting(tenant.id),
    ]);
    const { open, closedReason } = computeOpenState(
      settings,
      new Date(),
      available.length,
      waiting,
    );
    if (!open && closedReason === 'QUEUE_FULL') {
      throw helplineError(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.HELPLINE_QUEUE_FULL,
        'All our listeners are busy and the queue is full. Please try again shortly.',
      );
    }
    if (!open) {
      throw helplineError(
        HttpStatus.CONFLICT,
        ErrorCode.HELPLINE_CLOSED,
        closedReason === 'OUTSIDE_HOURS'
          ? 'The helpline is closed right now.'
          : 'No listener is available right now.',
      );
    }

    // A language the org does not offer falls back rather than refusing: a
    // stale page must never stop someone in distress from starting a chat.
    const language =
      input.language && settings.languages.includes(input.language)
        ? input.language
        : settings.languages.includes('en')
          ? 'en'
          : settings.languages[0];
    const displayName =
      (input.displayName ?? '')
        .trim()
        .slice(0, HELPLINE_LIMITS.DISPLAY_NAME_MAX_CHARS) ||
      HELPLINE_LIMITS.DEFAULT_DISPLAY_NAME;
    // Encrypted at rest; everything below this point uses the plaintext.
    const storedDisplayName = await this.cipher.encrypt(displayName);

    const { talker, chat } = await this.dataSource.transaction(
      async (manager) => {
        const now = new Date();
        const talker = await manager.save(
          manager.create(HelplineTalker, {
            tenantId: tenant.id,
            channel: HelplineChannel.TEXT_WEB,
            displayName: storedDisplayName,
            language,
            consentVersion: HELPLINE_CONSENT_VERSION,
            consentAcceptedAt: now,
            ipHash,
            userAgent: input.userAgent ? input.userAgent.slice(0, 255) : null,
            lastSeenAt: now,
          }),
        );
        const chat = await manager.save(
          manager.create(HelplineChat, {
            tenantId: tenant.id,
            talkerId: talker.id,
            channel: HelplineChannel.TEXT_WEB,
            status: HelplineChatStatus.WAITING,
            language,
            priority: 0,
            waitStartedAt: now,
            riskLevel: HelplineRiskLevel.NONE,
            previousListenerIds: [],
          }),
        );
        return { talker, chat };
      },
    );
    talker.displayName = displayName;

    await this.events.record(
      tenant.id,
      chat.id,
      HelplineChatEventType.ENQUEUED,
      null,
      { language },
    );
    helplineAudit('HELPLINE_SESSION_CREATED', tenant.id, {
      chatId: chat.id,
      talkerId: talker.id,
      language,
    });
    // Live from the start: the page connects its socket right after this
    // returns, and the sweep must not count those seconds as "gone".
    await this.presence
      .touchConnection('talker', talker.id)
      .catch(() => undefined);

    if (input.firstMessage && input.firstMessage.trim()) {
      try {
        await this.messageService.sendTalkerText(
          chat,
          input.firstMessage,
          null,
          talker.displayName,
        );
      } catch (error) {
        if (!(error instanceof HelplineSendRefused)) throw error;
        // An over-long or empty first message does not void the session;
        // the talker can type again in the waiting room.
        this.logger.warn(
          `First message refused for chat ${chat.id}: ${error.reason}`,
        );
      }
    }
    this.queue.queueChanged(tenant.id);

    const { token, expiresAt } = await this.tokens.sign({
      talkerId: talker.id,
      chatId: chat.id,
      tenantId: tenant.id,
    });
    const fresh = (await this.chats.findById(tenant.id, chat.id)) ?? chat;
    return {
      guestToken: token,
      expiresAt: expiresAt.toISOString(),
      chat: await this.views.guestChat(fresh, talker),
      messages: toGuestMessageDtos(
        await this.messages.listTalkerVisible(tenant.id, chat.id),
      ),
    };
  }

  private async isBlocked(tenantId: string, ipHash: string): Promise<boolean> {
    const since = new Date(Date.now() - HELPLINE_TIMINGS.BLOCK_WINDOW_MS);
    const count = await this.talkers.count({
      where: { tenantId, ipHash, blockedAt: MoreThan(since) },
    });
    return count > 0;
  }
}
