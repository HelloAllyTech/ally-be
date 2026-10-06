import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { DeviceTokenService } from 'src/notification/service/device-token.service';
import { InAppNotificationService } from 'src/notification/service/in-app-notification.service';
import { PushService } from 'src/notification/service/push.service';
import {
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineRiskFlagLevel,
  HelplineRiskSource,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineSettings, HelplineTenant } from '../type/helpline.types';
import { HelplineEventService } from './helpline-event.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineStaffDirectoryService } from './helpline-staff-directory.service';
import { HelplineTenantService } from './helpline-tenant.service';

/** `ALERT.type` on the socket (contract §6.3). */
export type HelplineAlertType =
  | 'RISK_HIGH'
  | 'HIGH_RISK_WAITING'
  | 'LISTENER_DISCONNECTED'
  | 'LISTENER_REQUESTED_HELP';

/** `in_app_notifications.type` per alert (varchar(50)). */
export const HELPLINE_NOTIFICATION_TYPES = {
  RISK_HIGH: 'HELPLINE_RISK_HIGH',
  HIGH_RISK_WAITING: 'HELPLINE_RISK_HIGH',
  LISTENER_DISCONNECTED: 'HELPLINE_LISTENER_DISCONNECTED',
  LISTENER_REQUESTED_HELP: 'HELPLINE_LISTENER_REQUESTED_HELP',
  ASSIGNED: 'HELPLINE_CHAT_ASSIGNED',
} as const;

/** Dedupe windows: one alert per chat per window, across replicas. */
export const HELPLINE_ALERT_WINDOWS = {
  /** RISK_HIGH and HIGH_RISK_WAITING share it (contract §9.3). */
  RISK_SECONDS: 10 * 60,
  HELP_SECONDS: 2 * 60,
  DISCONNECTED_SECONDS: 10 * 60,
  SLACK_TIMEOUT_MS: 3_000,
} as const;

export const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/';

/** The deep link every alert carries (a path; the client knows its host). */
export const HELPLINE_MONITOR_PATH = '/helpline/monitor';

export interface AlertCopyInput {
  type: HelplineAlertType;
  orgName: string;
  listenerName: string | null;
  source?: HelplineRiskSource | null;
  resourcesSent?: boolean;
}

const sourceLabel = (source?: HelplineRiskSource | null) =>
  source === HelplineRiskSource.CLASSIFIER
    ? 'the AI risk check'
    : 'the keyword screen';

/**
 * Plain, specific alert copy: what happened, why it was raised, and the one
 * thing to do next — open the monitor (the Stacks chunk "Escalation Design:
 * Thresholds for Human Intervention": the human receiving an escalation needs
 * what happened, why, and what is needed to proceed). Built ONLY from the
 * org name, the listener's alias and the flag's source — never a message
 * body, a quote, a note or the talker's name (invariant 5).
 */
export function alertCopy(input: AlertCopyInput): {
  title: string;
  body: string;
  slack: string;
} {
  const who = input.listenerName ? `${input.listenerName}'s chat` : 'A chat';
  switch (input.type) {
    case 'RISK_HIGH': {
      const title = 'High-risk flag in a helpline chat — open the monitor';
      const body =
        `${who} was flagged high risk by ${sourceLabel(input.source)}.` +
        (input.resourcesSent
          ? ' Emergency resources were sent to the talker.'
          : '') +
        ' Open the monitor to support the listener.';
      return {
        title,
        body,
        slack: `[${input.orgName}] High-risk flag (HIGH, ${sourceLabel(input.source)}) in a helpline chat. Open the monitor: ${HELPLINE_MONITOR_PATH}`,
      };
    }
    case 'HIGH_RISK_WAITING':
      return {
        title: 'High-risk talker waiting in the helpline queue',
        body:
          `A waiting talker was flagged high risk by ${sourceLabel(input.source)} and no listener has taken the chat yet. ` +
          'It is now first in the queue. Open the monitor to assign it.',
        slack: `[${input.orgName}] High-risk talker (HIGH, ${sourceLabel(input.source)}) waiting in the helpline queue with no listener. Open the monitor: ${HELPLINE_MONITOR_PATH}`,
      };
    case 'LISTENER_DISCONNECTED':
      return {
        title: 'A helpline listener has been disconnected for 10 minutes',
        body:
          `${input.listenerName ?? 'A listener'} lost their connection during an active chat and the talker is still there. ` +
          'Open the monitor to take over or reassign the chat.',
        slack: `[${input.orgName}] A helpline listener has been disconnected from an active chat for 10 minutes. Open the monitor: ${HELPLINE_MONITOR_PATH}`,
      };
    case 'LISTENER_REQUESTED_HELP':
      return {
        title: 'A listener asked for a supervisor',
        body: `${input.listenerName ?? 'A listener'} pressed Alert supervisor in an active helpline chat. Open the monitor to join them.`,
        slack: `[${input.orgName}] A helpline listener asked for a supervisor. Open the monitor: ${HELPLINE_MONITOR_PATH}`,
      };
  }
}

export interface SupervisorAlertRequest {
  type: HelplineAlertType;
  chat: Pick<HelplineChat, 'id' | 'tenantId' | 'listenerId' | 'status'>;
  level?: HelplineRiskFlagLevel | null;
  source?: HelplineRiskSource | null;
  resourcesSent?: boolean;
  /** The user who asked (LISTENER_REQUESTED_HELP); never notified themselves. */
  requestedBy?: number | null;
}

export interface SupervisorAlertResult {
  /** Supervisors this alert — or the deduped one already covering it — reached. */
  recipients: number;
  /** True when an earlier alert inside the window covered this one. */
  deduped: boolean;
}

/**
 * The one path every supervisor alert takes (contract §9.3 and §6.5): the
 * HIGH-risk protocol, the listener-gone sweep and a listener's own "Alert
 * supervisor". Per alert, after a cross-replica `SET NX EX` dedupe:
 *
 *  - socket `ALERT { type, chatId, level?, at }` to `supervisors:{tenantId}`;
 *  - one in-app notification per supervisor (when `supervisorAlertChannels.inApp`);
 *  - FCM push to their devices (when `push`) and the org's Slack webhook (only
 *    `https://hooks.slack.com/`, 3 s) — both detached, so a slow provider
 *    never holds up the flag;
 *  - a `SUPERVISOR_ALERTED` chat event.
 *
 * Recipients are the tenant's users holding `view:helpline:monitor`, minus
 * the chat's listener and whoever asked. Each channel fails on its own; none
 * can fail the caller.
 */
@Injectable()
export class HelplineAlertService {
  private readonly logger = LoggerService.getInstance(
    HelplineAlertService.name,
  );

  constructor(
    private readonly tenants: HelplineTenantService,
    private readonly settings: HelplineSettingsService,
    private readonly directory: HelplineStaffDirectoryService,
    private readonly profiles: HelplineProfileService,
    private readonly presence: HelplinePresenceService,
    private readonly realtime: HelplineRealtimeService,
    private readonly events: HelplineEventService,
    private readonly inApp: InAppNotificationService,
    private readonly deviceTokens: DeviceTokenService,
    private readonly push: PushService,
  ) {}

  /** HIGH risk (RISK_HIGH, or HIGH_RISK_WAITING while nobody has the chat). */
  riskHigh(
    chat: SupervisorAlertRequest['chat'],
    source: HelplineRiskSource,
    resourcesSent: boolean,
  ): Promise<SupervisorAlertResult> {
    return this.alert(
      {
        type:
          chat.status === HelplineChatStatus.WAITING
            ? 'HIGH_RISK_WAITING'
            : 'RISK_HIGH',
        chat,
        level: HelplineRiskFlagLevel.HIGH,
        source,
        resourcesSent,
      },
      `risk:${chat.id}`,
      HELPLINE_ALERT_WINDOWS.RISK_SECONDS,
    );
  }

  /** §6.5: the listener of an ACTIVE chat has been gone ≥ 10 min. */
  listenerDisconnected(
    chat: SupervisorAlertRequest['chat'],
  ): Promise<SupervisorAlertResult> {
    return this.alert(
      { type: 'LISTENER_DISCONNECTED', chat },
      `gone:${chat.id}`,
      HELPLINE_ALERT_WINDOWS.DISCONNECTED_SECONDS,
    );
  }

  /** The listener pressed "Alert supervisor" (deduped 2 min). */
  listenerRequestedHelp(
    chat: SupervisorAlertRequest['chat'],
    requestedBy: number,
  ): Promise<SupervisorAlertResult> {
    return this.alert(
      { type: 'LISTENER_REQUESTED_HELP', chat, requestedBy },
      `help:${chat.id}`,
      HELPLINE_ALERT_WINDOWS.HELP_SECONDS,
    );
  }

  /** Never throws; a failure before anyone was reached is `recipients: 0`. */
  async alert(
    request: SupervisorAlertRequest,
    window: string,
    windowSeconds: number,
  ): Promise<SupervisorAlertResult> {
    const { chat } = request;
    let claimed: boolean;
    try {
      claimed = await this.presence.claimWindow(window, windowSeconds, '0');
    } catch (error) {
      // Redis down: alert anyway — a duplicate is better than silence.
      this.logger.warn(
        `Alert dedupe unavailable for chat ${chat.id}: ${(error as Error).message}`,
      );
      claimed = true;
    }
    if (!claimed) {
      const stored = await this.presence.windowValue(window).catch(() => null);
      const recipients = Number(stored);
      return {
        recipients: Number.isFinite(recipients) ? recipients : 0,
        deduped: true,
      };
    }

    try {
      const tenant = await this.tenants.resolve(chat.tenantId);
      if (!tenant) return { recipients: 0, deduped: false };
      const settings = await this.settings.getSettings(tenant);
      const exclude = new Set(
        [chat.listenerId, request.requestedBy].filter(
          (id): id is number => id != null,
        ),
      );
      const recipients = (
        await this.directory.usersWithPermission(
          tenant,
          PERMISSIONS.VIEW_HELPLINE_MONITOR,
        )
      ).filter((u) => !exclude.has(u.id));
      await this.presence
        .setWindowValue(window, String(recipients.length))
        .catch(() => undefined);

      const at = new Date().toISOString();
      await this.realtime.emit(
        HelplineRooms.supervisors(chat.tenantId),
        HelplineServerEvents.ALERT,
        {
          type: request.type,
          chatId: chat.id,
          ...(request.level ? { level: request.level } : {}),
          at,
        },
      );

      const listenerName =
        chat.listenerId != null
          ? ((
              await this.profiles.aliases(chat.tenantId, [chat.listenerId])
            ).get(chat.listenerId) ?? null)
          : null;
      const copy = alertCopy({
        type: request.type,
        orgName: tenant.name,
        listenerName,
        source: request.source,
        resourcesSent: request.resourcesSent,
      });
      await this.notifyInApp(tenant, settings, request, recipients, copy);
      this.pushDetached(settings, request, recipients, copy);
      this.slackDetached(settings, copy.slack, chat.id);

      await this.events.record(
        chat.tenantId,
        chat.id,
        HelplineChatEventType.SUPERVISOR_ALERTED,
        request.requestedBy ?? null,
        {
          type: request.type,
          level: request.level ?? null,
          source: request.source ?? null,
          recipients: recipients.length,
          ...(request.requestedBy != null
            ? { requestedBy: request.requestedBy }
            : {}),
        },
      );
      return { recipients: recipients.length, deduped: false };
    } catch (error) {
      this.logger.error(
        `Supervisor alert (${request.type}) failed for chat ${chat.id}: ${(error as Error).message}`,
      );
      return { recipients: 0, deduped: false };
    }
  }

  /**
   * One listener (assign / transfer target): socket ALERT on their own room
   * and an in-app notification. No dedupe — each assignment is its own event.
   */
  async notifyAssignee(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
    listenerId: number,
    alertType: 'ASSIGNED' | 'TRANSFER_REQUESTED',
  ): Promise<void> {
    try {
      await this.realtime.emit(
        HelplineRooms.user(listenerId),
        HelplineServerEvents.ALERT,
        { type: alertType, chatId: chat.id, at: new Date().toISOString() },
      );
      const tenant = await this.tenants.resolve(chat.tenantId);
      if (!tenant) return;
      await this.inApp.create({
        userId: listenerId,
        tenantId: tenant.id,
        type: HELPLINE_NOTIFICATION_TYPES.ASSIGNED,
        title: 'A helpline chat was assigned to you',
        body: 'A supervisor asked you to take this chat. Open the helpline lobby to claim it.',
        data: { chatId: chat.id, screen: 'HelplineLobby' },
      });
    } catch (error) {
      this.logger.error(
        `Assignee alert failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }
  }

  private async notifyInApp(
    tenant: HelplineTenant,
    settings: HelplineSettings,
    request: SupervisorAlertRequest,
    recipients: { id: number }[],
    copy: { title: string; body: string },
  ): Promise<void> {
    if (!settings.supervisorAlertChannels.inApp) return;
    const type =
      request.type === 'HIGH_RISK_WAITING' || request.type === 'RISK_HIGH'
        ? HELPLINE_NOTIFICATION_TYPES.RISK_HIGH
        : HELPLINE_NOTIFICATION_TYPES[request.type];
    for (const recipient of recipients) {
      try {
        await this.inApp.create({
          userId: recipient.id,
          tenantId: tenant.id,
          type,
          title: copy.title,
          body: copy.body,
          // Deep-link hints only: ids and enums, never text.
          data: {
            chatId: request.chat.id,
            level: request.level ?? null,
            source: request.source ?? null,
            alert: request.type,
            screen: 'HelplineMonitor',
          },
        });
      } catch (error) {
        this.logger.error(
          `In-app alert failed for user ${recipient.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private pushDetached(
    settings: HelplineSettings,
    request: SupervisorAlertRequest,
    recipients: { id: number }[],
    copy: { title: string; body: string },
  ): void {
    if (!settings.supervisorAlertChannels.push || !recipients.length) return;
    void (async () => {
      const tokens = (
        await Promise.all(
          recipients.map((r) =>
            this.deviceTokens.getTokensForUser(r.id).catch(() => []),
          ),
        )
      ).flat();
      if (!tokens.length) return;
      await this.push.sendDataMessage(tokens, {
        title: copy.title,
        body: copy.body,
        type:
          request.type === 'LISTENER_DISCONNECTED' ||
          request.type === 'LISTENER_REQUESTED_HELP'
            ? HELPLINE_NOTIFICATION_TYPES[request.type]
            : HELPLINE_NOTIFICATION_TYPES.RISK_HIGH,
        screen: 'HelplineMonitor',
      });
    })().catch((error) =>
      this.logger.error(
        `Push alert failed for chat ${request.chat.id}: ${(error as Error).message}`,
      ),
    );
  }

  private slackDetached(
    settings: HelplineSettings,
    text: string,
    chatId: string,
  ): void {
    const url = settings.supervisorAlertChannels.slackWebhookUrl;
    if (!url || !url.startsWith(SLACK_WEBHOOK_PREFIX)) return;
    void axios
      .post(url, { text }, { timeout: HELPLINE_ALERT_WINDOWS.SLACK_TIMEOUT_MS })
      .catch((error) =>
        // Never log the URL: a Slack webhook URL is a credential.
        this.logger.warn(
          `Slack alert failed for chat ${chatId}: ${(error as Error).message}`,
        ),
      );
  }
}
