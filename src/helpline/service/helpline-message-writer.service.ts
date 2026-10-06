import { Injectable } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import {
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineSenderRole,
  HelplineStaffSystemKind,
} from '../constants/helpline.constants';
import { HelplineChat } from '../entity/helpline-chat.entity';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { HelplineMessageRepository } from '../repository/helpline-message.repository';
import { HelplineProfileService } from './helpline-profile.service';
import { HelplineRealtimeService } from './helpline-realtime.service';

/**
 * Inserts a message row and emits it — persist first, then emit (invariant 3).
 * Shared by talker/listener TEXT, SYSTEM notices and staff-only RISK rows so
 * every row reaches the sockets through `HelplineRealtimeService.emitMessage`,
 * i.e. through the serialisers.
 */
@Injectable()
export class HelplineMessageWriter {
  private readonly logger = LoggerService.getInstance(
    HelplineMessageWriter.name,
  );

  constructor(
    private readonly messages: HelplineMessageRepository,
    private readonly realtime: HelplineRealtimeService,
    private readonly profiles: HelplineProfileService,
  ) {}

  /** The name a staff DTO shows for this row's sender. */
  async senderName(
    chat: Pick<HelplineChat, 'tenantId'>,
    message: HelplineMessage,
    talkerName: string | null,
  ): Promise<string | null> {
    if (message.senderRole === HelplineSenderRole.TALKER) return talkerName;
    if (message.senderUserId == null) return null;
    const names = await this.profiles.aliases(chat.tenantId, [
      message.senderUserId,
    ]);
    return names.get(message.senderUserId) ?? null;
  }

  /** Emit failures are logged inside the realtime service; this never throws. */
  async emit(
    chat: Pick<HelplineChat, 'tenantId'>,
    message: HelplineMessage,
    talkerName: string | null = null,
  ): Promise<void> {
    try {
      const name = await this.senderName(chat, message, talkerName);
      await this.realtime.emitMessage(message, name);
    } catch (error) {
      this.logger.error(
        `Could not emit helpline message ${message.id}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * A SYSTEM notice. Talker-visible only for a guest kind AND
   * `visibleToTalker` — staff-only kinds stay staff-side regardless.
   */
  async system(
    chat: HelplineChat,
    kind: HelplineGuestSystemKind | HelplineStaffSystemKind,
    content: string,
    options: { visibleToTalker: boolean; params?: Record<string, string> },
  ): Promise<HelplineMessage> {
    const guestKind = (
      Object.values(HelplineGuestSystemKind) as string[]
    ).includes(kind);
    const message = await this.messages.insert({
      tenantId: chat.tenantId,
      chatId: chat.id,
      senderRole: HelplineSenderRole.SYSTEM,
      senderUserId: null,
      type: HelplineMessageType.SYSTEM,
      systemKind: kind,
      content,
      visibleToTalker: guestKind && options.visibleToTalker,
      metadata: options.params ? { params: options.params } : null,
    });
    await this.emit(chat, message);
    return message;
  }

  /**
   * A staff-only row: RISK, SUGGESTION, NUDGE, STAGE, WHISPER, or a staff-only
   * SYSTEM kind. `emit: false` persists without the MESSAGE_RECEIVED emit, for
   * rows that go out on their own event instead (SUGGESTIONS, NUDGE, STAGE,
   * WHISPER — contract §6.3), so a client never gets the same row twice.
   */
  async staffOnly(
    chat: Pick<HelplineChat, 'id' | 'tenantId'>,
    type: Exclude<HelplineMessageType, HelplineMessageType.TEXT>,
    content: string,
    metadata: Record<string, unknown> | null,
    options: {
      senderRole?: HelplineSenderRole;
      senderUserId?: number | null;
      parentMessageId?: number | null;
      systemKind?: string | null;
      emit?: boolean;
    } = {},
  ): Promise<HelplineMessage> {
    const message = await this.messages.insert({
      tenantId: chat.tenantId,
      chatId: chat.id,
      senderRole: options.senderRole ?? HelplineSenderRole.SYSTEM,
      senderUserId: options.senderUserId ?? null,
      type,
      systemKind: options.systemKind ?? null,
      content,
      parentMessageId: options.parentMessageId ?? null,
      visibleToTalker: false,
      metadata,
    });
    if (options.emit !== false) await this.emit(chat, message);
    return message;
  }
}
