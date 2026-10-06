import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import {
  HELPLINE_SYSTEM_COPY,
  HELPLINE_TIMINGS,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineGuestSystemKind,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineSettings } from '../type/helpline.types';
import {
  SweepAction,
  decideSweepActions,
} from '../util/helpline-lifecycle-decisions';
import { HelplineAlertService } from './helpline-alert.service';
import { HelplineChatLifecycleService } from './helpline-chat-lifecycle.service';
import { HelplineEventService } from './helpline-event.service';
import { HelplineMessageWriter } from './helpline-message-writer.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';
import { HelplineSettingsService } from './helpline-settings.service';
import { HelplineTenantService } from './helpline-tenant.service';

/** Per-chat once-flags (`hl:flag:{chatId}:{name}`). */
export const SWEEP_FLAGS = {
  RECONNECTING: 'listener-reconnecting',
  LISTENER_GONE: 'listener-gone',
  LISTENER_ALERT: 'listener-alert',
} as const;

/**
 * The lifecycle sweep (contract §6.5): every 15 s on each replica, but only
 * the replica holding `hl:sweep` (14 s) does the work. The decisions are the
 * pure `decideSweepActions`; this class gathers state and applies them.
 *
 * Off when NODE_ENV=test (no timers in unit suites) or HELPLINE_SWEEP=off.
 */
@Injectable()
export class HelplineLifecycleService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    HelplineLifecycleService.name,
  );
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly chats: HelplineChatRepository,
    private readonly presence: HelplinePresenceService,
    private readonly settings: HelplineSettingsService,
    private readonly tenants: HelplineTenantService,
    private readonly lifecycle: HelplineChatLifecycleService,
    private readonly writer: HelplineMessageWriter,
    private readonly events: HelplineEventService,
    private readonly queue: HelplineQueueService,
    private readonly realtime: HelplineRealtimeService,
    private readonly alerts: HelplineAlertService,
  ) {}

  static isDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.NODE_ENV === 'test' || env.HELPLINE_SWEEP === 'off';
  }

  onApplicationBootstrap(): void {
    if (HelplineLifecycleService.isDisabled()) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, HELPLINE_TIMINGS.SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const locked = await this.redisService.acquireLock(
        'hl:sweep',
        HELPLINE_TIMINGS.SWEEP_LOCK_SECONDS,
      );
      if (!locked) return;
      const tenantIds = await this.chats.listOpenTenantIdsAcrossTenants();
      for (const tenantId of tenantIds) {
        await this.sweepTenant(tenantId).catch((error) =>
          this.logger.error(
            `Helpline sweep failed for tenant ${tenantId}: ${(error as Error).message}`,
          ),
        );
      }
    } catch (error) {
      this.logger.error(`Helpline sweep failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async sweepTenant(tenantId: string, now = new Date()): Promise<void> {
    const tenant = await this.tenants.resolve(tenantId);
    const settings = tenant
      ? await this.settings.getSettings(tenant)
      : this.settings.defaults;
    const open = await this.chats.listOpen(tenantId);
    for (const chat of open) {
      try {
        await this.sweepChat(chat, settings, now);
      } catch (error) {
        this.logger.error(
          `Helpline sweep failed for chat ${chat.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async sweepChat(
    chat: HelplineChat,
    settings: HelplineSettings,
    now: Date,
  ): Promise<void> {
    const [talkerGoneSince, listenerGoneSince, flags] = await Promise.all([
      this.presence.goneSince('talker', chat.talkerId),
      chat.status === HelplineChatStatus.ACTIVE && chat.listenerId != null
        ? this.presence.goneSince('listener', chat.listenerId)
        : Promise.resolve(null),
      this.presence.flags(chat.id, Object.values(SWEEP_FLAGS)),
    ]);
    const actions = decideSweepActions(chat, {
      now,
      maxWaitMinutes: settings.maxWaitMinutes,
      idleEndMinutes: settings.idleEndMinutes,
      talkerGoneSince,
      listenerGoneSince,
      reconnectingSent: flags[SWEEP_FLAGS.RECONNECTING],
      listenerFlagged: flags[SWEEP_FLAGS.LISTENER_GONE],
      alertSent: flags[SWEEP_FLAGS.LISTENER_ALERT],
    });
    for (const action of actions) {
      await this.apply(chat, action, now);
    }
  }

  private async apply(
    chat: HelplineChat,
    action: SweepAction,
    now: Date,
  ): Promise<void> {
    switch (action.type) {
      case 'END':
        await this.lifecycle.endChat(chat, action.reason, null);
        return;
      case 'MARK_ABANDONED':
        if (await this.chats.setAbandoned(chat.tenantId, chat.id, now)) {
          this.queue.queueChanged(chat.tenantId);
        }
        return;
      case 'CLEAR_ABANDONED':
        if (await this.chats.setAbandoned(chat.tenantId, chat.id, null)) {
          this.queue.queueChanged(chat.tenantId);
        }
        return;
      case 'LISTENER_RECONNECTING':
        if (
          await this.presence.setFlagOnce(chat.id, SWEEP_FLAGS.RECONNECTING)
        ) {
          await this.writer.system(
            chat,
            HelplineGuestSystemKind.LISTENER_RECONNECTING,
            HELPLINE_SYSTEM_COPY.LISTENER_RECONNECTING,
            { visibleToTalker: true },
          );
          await this.events.record(
            chat.tenantId,
            chat.id,
            HelplineChatEventType.LISTENER_DISCONNECTED,
            chat.listenerId,
          );
        }
        return;
      case 'LISTENER_BACK':
        await this.listenerBack(chat);
        return;
      case 'LISTENER_GONE_FLAG':
        if (
          await this.presence.setFlagOnce(chat.id, SWEEP_FLAGS.LISTENER_GONE)
        ) {
          await this.participantStatus(chat, false);
        }
        return;
      case 'LISTENER_GONE_CLEAR':
        if (await this.presence.clearFlag(chat.id, SWEEP_FLAGS.LISTENER_GONE)) {
          await this.participantStatus(chat, true);
        }
        return;
      case 'LISTENER_GONE_ALERT':
        // Once per chat (the sweep flag), through the shared alert service:
        // socket ALERT, in-app notifications, push/Slack per org settings and
        // the SUPERVISOR_ALERTED event — never content.
        if (
          await this.presence.setFlagOnce(chat.id, SWEEP_FLAGS.LISTENER_ALERT)
        ) {
          await this.alerts.listenerDisconnected(chat);
        }
        return;
    }
  }

  /** Also called on the listener's socket reconnect, so the notice is immediate. */
  async listenerBack(chat: HelplineChat): Promise<void> {
    if (!(await this.presence.clearFlag(chat.id, SWEEP_FLAGS.RECONNECTING)))
      return;
    await this.writer.system(
      chat,
      HelplineGuestSystemKind.LISTENER_BACK,
      HELPLINE_SYSTEM_COPY.LISTENER_BACK,
      { visibleToTalker: true },
    );
    await this.events.record(
      chat.tenantId,
      chat.id,
      HelplineChatEventType.LISTENER_RECONNECTED,
      chat.listenerId,
    );
  }

  async participantStatus(
    chat: HelplineChat,
    connected: boolean,
  ): Promise<void> {
    const payload = { chatId: chat.id, role: 'LISTENER', connected };
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.PARTICIPANT_STATUS,
      payload,
    );
    // The monitor view flags it too, without having joined the chat.
    await this.realtime.emit(
      HelplineRooms.supervisors(chat.tenantId),
      HelplineServerEvents.PARTICIPANT_STATUS,
      payload,
    );
  }
}
