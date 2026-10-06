import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import {
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineGuestIdentity } from '../type/helpline.types';
import { HelplineEventService } from './helpline-event.service';
import {
  HelplineLifecycleService,
  SWEEP_FLAGS,
} from './helpline-lifecycle.service';
import { HelplineNotifyService } from './helpline-notify.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineQueueService } from './helpline-queue.service';
import { HelplineRealtimeService } from './helpline-realtime.service';

/**
 * What a socket connecting, heart-beating or going away means for presence,
 * liveness and the other side (contract §6.4 / §6.5). Kept out of the gateway
 * so the gateway only routes, and so every rule here runs without a socket.
 */
@Injectable()
export class HelplineConnectionService {
  private readonly logger = LoggerService.getInstance(
    HelplineConnectionService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly presence: HelplinePresenceService,
    private readonly events: HelplineEventService,
    private readonly queue: HelplineQueueService,
    private readonly notify: HelplineNotifyService,
    private readonly realtime: HelplineRealtimeService,
    private readonly lifecycle: HelplineLifecycleService,
  ) {}

  async talkerConnected(identity: HelplineGuestIdentity): Promise<void> {
    const wasGone = await this.presence.wasGone('talker', identity.talkerId);
    await this.presence.touchConnection('talker', identity.talkerId);
    const chat = await this.chats.findForGuest(
      identity.tenantId,
      identity.chatId,
      identity.talkerId,
    );
    if (!chat || chat.status === HelplineChatStatus.ENDED) return;

    // Back before the abandoned wait expired: their original place stands.
    if (chat.status === HelplineChatStatus.WAITING && chat.abandonedAt) {
      if (await this.chats.setAbandoned(chat.tenantId, chat.id, null)) {
        this.queue.queueChanged(chat.tenantId);
      }
    }
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.PARTICIPANT_STATUS,
      { chatId: chat.id, role: 'TALKER', connected: true },
    );
    if (wasGone && chat.status === HelplineChatStatus.ACTIVE) {
      await this.events.record(
        chat.tenantId,
        chat.id,
        HelplineChatEventType.TALKER_RECONNECTED,
      );
    }
  }

  /** `stillConnectedHere`: another socket of this talker remains on this replica. */
  async talkerDisconnected(
    identity: HelplineGuestIdentity,
    stillConnectedHere: boolean,
  ): Promise<void> {
    if (stillConnectedHere) return;
    await this.presence.dropConnection('talker', identity.talkerId);
    const chat = await this.chats.findForGuest(
      identity.tenantId,
      identity.chatId,
      identity.talkerId,
    );
    if (!chat || chat.status === HelplineChatStatus.ENDED) return;
    await this.realtime.emit(
      HelplineRooms.staff(chat.id),
      HelplineServerEvents.PARTICIPANT_STATUS,
      { chatId: chat.id, role: 'TALKER', connected: false },
    );
    if (chat.status === HelplineChatStatus.ACTIVE) {
      await this.events.record(
        chat.tenantId,
        chat.id,
        HelplineChatEventType.TALKER_DISCONNECTED,
      );
    }
  }

  /**
   * A staff socket connected. Returns the chat ids whose staff rooms it must
   * join (contract §6.1: every ACTIVE chat it is listener of record for).
   */
  async staffConnected(
    tenantId: string,
    userId: number,
    permissions: string[],
  ): Promise<string[]> {
    const listens = permissions.includes(PERMISSIONS.VIEW_HELPLINE_LOBBY);
    if (listens) {
      await this.presence.touchConnection('listener', userId);
    }
    const active = await this.chats.listActiveForListener(tenantId, userId);
    for (const chat of active) {
      try {
        await this.lifecycle.listenerBack(chat);
        if (await this.presence.clearFlag(chat.id, SWEEP_FLAGS.LISTENER_GONE)) {
          await this.lifecycle.participantStatus(chat, true);
        } else {
          await this.realtime.emit(
            HelplineRooms.staff(chat.id),
            HelplineServerEvents.PARTICIPANT_STATUS,
            { chatId: chat.id, role: 'LISTENER', connected: true },
          );
        }
      } catch (error) {
        this.logger.error(
          `Reconnect handling failed for chat ${chat.id}: ${(error as Error).message}`,
        );
      }
    }
    if (listens) {
      await this.notify.presenceUpdated(tenantId, userId);
      this.queue.queueChanged(tenantId);
    }
    return active.map((c) => c.id);
  }

  async staffDisconnected(
    tenantId: string,
    userId: number,
    permissions: string[],
    stillConnectedHere: boolean,
  ): Promise<void> {
    if (
      stillConnectedHere ||
      !permissions.includes(PERMISSIONS.VIEW_HELPLINE_LOBBY)
    ) {
      return;
    }
    await this.presence.dropConnection('listener', userId);
    // Availability changed: the public status and lobby counts follow now,
    // not at the next cache expiry.
    this.queue.queueChanged(tenantId);
    await this.notify.presenceUpdated(tenantId, userId);
  }

  async heartbeat(
    kind: 'talker' | 'listener',
    id: string | number,
  ): Promise<void> {
    await this.presence.touchConnection(kind, id);
  }
}
