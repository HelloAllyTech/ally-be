import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { HelplineChatEventType } from '../constants/helpline.constants';
import { HelplineChatEvent } from '../entity/helpline-chat-event.entity';

type EventPayload = Record<string, string | number | boolean | null>;

/**
 * The chat timeline (`helpline_chat_events`). Payloads are typed to scalars so
 * a message body cannot be passed by accident of shape (invariant 5).
 */
@Injectable()
export class HelplineEventService {
  private readonly logger = LoggerService.getInstance(
    HelplineEventService.name,
  );

  constructor(
    @InjectRepository(HelplineChatEvent)
    private readonly events: Repository<HelplineChatEvent>,
  ) {}

  /** Never throws: a timeline write must not fail the action it describes. */
  async record(
    tenantId: string,
    chatId: string,
    type: HelplineChatEventType,
    actorUserId: number | null = null,
    payload: EventPayload | null = null,
  ): Promise<void> {
    try {
      await this.events.save(
        this.events.create({ tenantId, chatId, type, actorUserId, payload }),
      );
    } catch (error) {
      this.logger.error(
        `Could not record ${type} for chat ${chatId}: ${(error as Error).message}`,
      );
    }
  }

  listForChat(tenantId: string, chatId: string): Promise<HelplineChatEvent[]> {
    return this.events.find({
      where: { tenantId, chatId },
      order: { createdAt: 'ASC' },
      take: 500,
    });
  }
}
