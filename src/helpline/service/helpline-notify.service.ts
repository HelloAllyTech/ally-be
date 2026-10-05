import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  HelplineAccess,
  HelplineRooms,
  HelplineServerEvents,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineChatRepository } from '../repository/helpline-chat.repository';
import { HelplineChatViewService } from './helpline-chat-view.service';
import { HelplinePresenceService } from './helpline-presence.service';
import { HelplineRealtimeService } from './helpline-realtime.service';

/**
 * Pushes whose payload depends on who receives it.
 *
 * `CHAT_UPDATED` carries a StaffChatDto, and its `myAccess` is per viewer: the
 * listener of record is LISTENER, everyone else in `staff:{chatId}` (monitoring
 * supervisors, previous listeners) is READ_ONLY. So the listener's own sockets
 * get the LISTENER variant on `user:{id}`, and the staff room gets the
 * READ_ONLY variant with the listener's user room excepted. The talker room
 * gets the guest DTO.
 */
@Injectable()
export class HelplineNotifyService {
  private readonly logger = LoggerService.getInstance(
    HelplineNotifyService.name,
  );

  constructor(
    private readonly chats: HelplineChatRepository,
    private readonly views: HelplineChatViewService,
    private readonly presence: HelplinePresenceService,
    private readonly realtime: HelplineRealtimeService,
  ) {}

  async chatUpdated(
    chat: HelplineChat,
    options: { talker?: boolean } = {},
  ): Promise<void> {
    try {
      const staffRoom = HelplineRooms.staff(chat.id);
      if (chat.listenerId != null) {
        const listenerRoom = HelplineRooms.user(chat.listenerId);
        await this.realtime.emit(
          listenerRoom,
          HelplineServerEvents.CHAT_UPDATED,
          {
            chat: await this.views.staffChat(chat, HelplineAccess.LISTENER),
          },
        );
        await this.realtime.emit(
          staffRoom,
          HelplineServerEvents.CHAT_UPDATED,
          { chat: await this.views.staffChat(chat, HelplineAccess.READ_ONLY) },
          { except: listenerRoom },
        );
      } else {
        await this.realtime.emit(staffRoom, HelplineServerEvents.CHAT_UPDATED, {
          chat: await this.views.staffChat(chat, HelplineAccess.READ_ONLY),
        });
      }
      if (options.talker !== false) {
        await this.realtime.emit(
          HelplineRooms.talker(chat.id),
          HelplineServerEvents.CHAT_UPDATED,
          { chat: await this.views.guestChat(chat) },
        );
      }
    } catch (error) {
      this.logger.error(
        `CHAT_UPDATED failed for chat ${chat.id}: ${(error as Error).message}`,
      );
    }
  }

  /** `PRESENCE_UPDATED` to every socket of one listener. */
  async presenceUpdated(tenantId: string, userId: number): Promise<void> {
    try {
      const [presence, activeChatCount] = await Promise.all([
        this.presence.getPresence(tenantId, userId),
        this.chats.countActiveForListener(tenantId, userId),
      ]);
      await this.realtime.emit(
        HelplineRooms.user(userId),
        HelplineServerEvents.PRESENCE_UPDATED,
        { presence, activeChatCount },
      );
    } catch (error) {
      this.logger.error(
        `PRESENCE_UPDATED failed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
