import {
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineRooms,
  HelplineSenderRole,
  HelplineServerEvents,
  TALKER_ROOM_EVENTS,
  TALKER_VISIBLE_MESSAGE_TYPES,
} from '../constants/helpline.constants';
import { HelplineMessage } from '../entity/helpline-message.entity';
import { GuestMessageDto, StaffMessageDto } from '../type/helpline.types';

/**
 * The ONLY two message serialisers in the helpline (contract §6.2).
 *
 * Invariants 1 and 2 hold here: a row reaches a talker only through
 * `toGuestMessageDto`, which refuses anything that is not a talker-visible
 * TEXT or SYSTEM row, and the realtime layer only ever puts guest DTOs in a
 * `talker:` room (`planMessageEmits`, `assertTalkerRoomPayload`).
 */

const GUEST_SYSTEM_KINDS = new Set<string>(
  Object.values(HelplineGuestSystemKind),
);

export class HelplineSerialisationError extends Error {}

/** True only for rows a talker may ever see. Mirrors the DB CHECK. */
export function isTalkerVisible(
  message: Pick<HelplineMessage, 'type' | 'visibleToTalker' | 'systemKind'>,
): boolean {
  if (message.visibleToTalker !== true) return false;
  if (!TALKER_VISIBLE_MESSAGE_TYPES.includes(message.type)) return false;
  // A SYSTEM row with a staff-only kind (TALKER_DISCONNECTED, TAKEN_OVER …)
  // stays staff-side even if something set the flag.
  if (
    message.type === HelplineMessageType.SYSTEM &&
    !GUEST_SYSTEM_KINDS.has(message.systemKind ?? '')
  ) {
    return false;
  }
  return true;
}

const guestParams = (
  metadata: Record<string, unknown> | null,
): Record<string, string> | undefined => {
  const params = metadata?.params;
  if (!params || typeof params !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    params as Record<string, unknown>,
  )) {
    if (typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

/**
 * Throws for a row that is not talker-visible — callers must filter first
 * (`toGuestMessageDtos` does). A throw rather than a silent skip, so a caller
 * that forgets to filter fails loudly in tests instead of in a talker's
 * browser.
 */
export function toGuestMessageDto(message: HelplineMessage): GuestMessageDto {
  if (!isTalkerVisible(message)) {
    throw new HelplineSerialisationError(
      `Message ${message.id} (${message.type}) is not talker-visible`,
    );
  }
  const from: GuestMessageDto['from'] =
    message.senderRole === HelplineSenderRole.TALKER
      ? 'ME'
      : message.senderRole === HelplineSenderRole.LISTENER ||
          message.senderRole === HelplineSenderRole.SUPERVISOR
        ? 'LISTENER'
        : 'SERVICE';
  const dto: GuestMessageDto = {
    id: message.id,
    clientMessageId:
      message.senderRole === HelplineSenderRole.TALKER
        ? message.clientMessageId
        : null,
    from,
    type: message.type as GuestMessageDto['type'],
    systemKind:
      message.type === HelplineMessageType.SYSTEM
        ? (message.systemKind as HelplineGuestSystemKind)
        : null,
    content: message.content,
    createdAt: new Date(message.createdAt).toISOString(),
  };
  const params = guestParams(message.metadata);
  if (params) dto.params = params;
  return dto;
}

/** Filters to talker-visible rows, then serialises. */
export function toGuestMessageDtos(
  messages: HelplineMessage[],
): GuestMessageDto[] {
  return messages.filter(isTalkerVisible).map(toGuestMessageDto);
}

export function toStaffMessageDto(
  message: HelplineMessage,
  senderName: string | null,
): StaffMessageDto {
  return {
    id: message.id,
    chatId: message.chatId,
    clientMessageId: message.clientMessageId,
    type: message.type,
    senderRole: message.senderRole,
    senderUserId: message.senderUserId,
    senderName,
    systemKind: message.systemKind,
    content: message.content,
    parentMessageId: message.parentMessageId,
    visibleToTalker: message.visibleToTalker,
    metadata: message.metadata,
    createdAt: new Date(message.createdAt).toISOString(),
    erased: message.erasedAt != null,
  };
}

export interface PlannedEmit {
  room: string;
  event: string;
  payload: unknown;
}

/**
 * Where a newly persisted message goes. The staff room always gets the staff
 * DTO; the talker room gets the guest DTO, and only for a talker-visible row.
 * Pure, so the routing rule is unit-tested rather than trusted.
 */
export function planMessageEmits(
  message: HelplineMessage,
  senderName: string | null,
): PlannedEmit[] {
  const emits: PlannedEmit[] = [
    {
      room: HelplineRooms.staff(message.chatId),
      event: HelplineServerEvents.MESSAGE_RECEIVED,
      payload: {
        chatId: message.chatId,
        message: toStaffMessageDto(message, senderName),
      },
    },
  ];
  if (isTalkerVisible(message)) {
    emits.push({
      room: HelplineRooms.talker(message.chatId),
      event: HelplineServerEvents.MESSAGE_RECEIVED,
      payload: { chatId: message.chatId, message: toGuestMessageDto(message) },
    });
  }
  return emits;
}

const STAFF_ONLY_KEYS = ['visibleToTalker', 'senderUserId', 'metadata'];

/**
 * The last check before anything is emitted to a `talker:` room — applied by
 * `HelplineRealtimeService.emit` before publishing AND by the gateway before
 * a local emit, so neither a caller bug nor a malformed broker message can
 * reach a talker socket. Returns a reason when the emit must be dropped.
 */
export function talkerRoomViolation(
  room: string,
  event: string,
  payload: unknown,
): string | null {
  if (!room.startsWith('talker:')) return null;
  if (!TALKER_ROOM_EVENTS.has(event)) {
    return `event ${event} is staff-only`;
  }
  if (event === HelplineServerEvents.MESSAGE_RECEIVED) {
    const message = (payload as { message?: Record<string, unknown> } | null)
      ?.message;
    if (!message || typeof message !== 'object') return 'no message';
    if (STAFF_ONLY_KEYS.some((key) => key in message)) {
      return 'staff DTO addressed to a talker room';
    }
    if (
      message.type !== HelplineMessageType.TEXT &&
      message.type !== HelplineMessageType.SYSTEM
    ) {
      return `message type ${String(message.type)} is staff-only`;
    }
    if (
      message.type === HelplineMessageType.SYSTEM &&
      !GUEST_SYSTEM_KINDS.has(String(message.systemKind ?? ''))
    ) {
      return `system kind ${String(message.systemKind)} is staff-only`;
    }
  }
  if (event === HelplineServerEvents.CHAT_UPDATED) {
    const chat = (payload as { chat?: Record<string, unknown> } | null)?.chat;
    // A StaffChatDto carries `myAccess` and the talker's own details block.
    if (!chat || 'myAccess' in chat || 'talker' in chat) {
      return 'staff chat DTO addressed to a talker room';
    }
  }
  return null;
}

/**
 * Edit distance between a copilot suggestion and what the listener sent
 * (StaffMessageDto `fromSuggestion.editedDistance`). Two-row Levenshtein,
 * bounded by the 2,000-character message cap.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}
