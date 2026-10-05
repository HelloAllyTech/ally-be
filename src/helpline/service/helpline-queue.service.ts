import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  HELPLINE_TIMINGS,
  HelplineChatStatus,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { LobbyCountsDto, LobbyEntryDto } from '../type/helpline.types';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineRealtimeService } from './helpline-realtime.service';

/**
 * The lobby broadcast. Any change to who is waiting, in what order, or how
 * many listeners are available calls `queueChanged(tenantId)`; within a 250 ms
 * window those coalesce into one recompute that emits `QUEUE_UPDATED` to the
 * lobby, `QUEUE_POSITION` to each waiting talker, and invalidates the public
 * status cache.
 */
@Injectable()
export class HelplineQueueService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    HelplineQueueService.name,
  );
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly views: HelplineChatViewService,
    private readonly presence: HelplinePresenceService,
    private readonly realtime: HelplineRealtimeService,
  ) {}

  onModuleDestroy(): void {
    this.pending.forEach((timer) => clearTimeout(timer));
    this.pending.clear();
  }

  async buildQueue(
    tenantId: string,
  ): Promise<{ waiting: LobbyEntryDto[]; counts: LobbyCountsDto }> {
    const [queue, active, available] = await Promise.all([
      this.chats.listQueue(tenantId),
      this.chats.countActive(tenantId),
      this.presence.availableListenerIds(tenantId),
    ]);
    const waiting = await this.views.lobbyEntries(tenantId, queue);
    return {
      waiting,
      counts: {
        waiting: queue.filter((c) => c.status === HelplineChatStatus.WAITING)
          .length,
        active,
        listenersAvailable: available.length,
      },
    };
  }

  queueChanged(tenantId: string): void {
    void this.presence.invalidateStatus(tenantId).catch(() => undefined);
    if (this.pending.has(tenantId)) return;
    const timer = setTimeout(() => {
      this.pending.delete(tenantId);
      void this.publishNow(tenantId);
    }, HELPLINE_TIMINGS.QUEUE_UPDATE_DEBOUNCE_MS);
    timer.unref?.();
    this.pending.set(tenantId, timer);
  }

  async publishNow(tenantId: string): Promise<void> {
    try {
      const { waiting, counts } = await this.buildQueue(tenantId);
      await this.realtime.emit(
        HelplineRooms.lobby(tenantId),
        HelplineServerEvents.QUEUE_UPDATED,
        { waiting, counts },
      );
      // Positions follow the lobby order, NEW entries only (a transfer is
      // already ACTIVE, its talker is not waiting in a queue).
      let position = 0;
      for (const entry of waiting) {
        if (entry.kind !== 'NEW') continue;
        position += 1;
        await this.realtime.emit(
          HelplineRooms.talker(entry.chatId),
          HelplineServerEvents.QUEUE_POSITION,
          { chatId: entry.chatId, position },
        );
      }
    } catch (error) {
      this.logger.error(
        `Queue broadcast failed for tenant ${tenantId}: ${(error as Error).message}`,
      );
    }
  }
}
