import { MessageBrokerChannel } from 'src/message-broker/constants/message-broker.constants';
import {
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineSenderRole,
  HelplineServerEvents,
  HelplineStaffSystemKind,
} from '../../constants/helpline.constants';
import { HelplineMessage } from '../../entity/helpline-message.entity';
import { HelplineRealtimeService } from '../../service/helpline-realtime.service';
import {
  HelplineSerialisationError,
  editDistance,
  isTalkerVisible,
  planMessageEmits,
  talkerRoomViolation,
  toGuestMessageDto,
  toGuestMessageDtos,
  toStaffMessageDto,
} from '../helpline-serializers';

const CHAT = '11111111-1111-4111-8111-111111111111';

const message = (overrides: Partial<HelplineMessage>): HelplineMessage =>
  ({
    id: 1,
    tenantId: 'tenant-1',
    chatId: CHAT,
    senderRole: HelplineSenderRole.TALKER,
    senderUserId: null,
    type: HelplineMessageType.TEXT,
    systemKind: null,
    content: 'hello',
    parentMessageId: null,
    clientMessageId: null,
    visibleToTalker: true,
    metadata: null,
    erasedAt: null,
    createdAt: new Date('2026-10-05T10:00:00Z'),
    updatedAt: new Date('2026-10-05T10:00:00Z'),
    ...overrides,
  }) as HelplineMessage;

const STAFF_ONLY_TYPES = [
  HelplineMessageType.SUGGESTION,
  HelplineMessageType.NUDGE,
  HelplineMessageType.STAGE,
  HelplineMessageType.RISK,
  HelplineMessageType.WHISPER,
  HelplineMessageType.TRANSFER,
];

describe('helpline serialisers (invariants 1 and 2)', () => {
  describe('toGuestMessageDto', () => {
    it.each(STAFF_ONLY_TYPES)(
      'refuses a %s row, even one wrongly marked visible',
      (type) => {
        const row = message({
          type,
          visibleToTalker: true,
          senderRole: HelplineSenderRole.COPILOT,
        });
        expect(isTalkerVisible(row)).toBe(false);
        expect(() => toGuestMessageDto(row)).toThrow(
          HelplineSerialisationError,
        );
      },
    );

    it('refuses a TEXT row that is not talker-visible', () => {
      expect(() =>
        toGuestMessageDto(message({ visibleToTalker: false })),
      ).toThrow(HelplineSerialisationError);
    });

    it.each(Object.values(HelplineStaffSystemKind))(
      'refuses a SYSTEM row of the staff-only kind %s',
      (systemKind) => {
        const row = message({
          type: HelplineMessageType.SYSTEM,
          senderRole: HelplineSenderRole.SYSTEM,
          systemKind,
          visibleToTalker: true,
        });
        expect(isTalkerVisible(row)).toBe(false);
      },
    );

    it('serialises talker, listener and service rows with no staff fields', () => {
      const mine = toGuestMessageDto(message({ clientMessageId: 'c-1' }));
      expect(mine).toEqual({
        id: 1,
        clientMessageId: 'c-1',
        from: 'ME',
        type: HelplineMessageType.TEXT,
        systemKind: null,
        content: 'hello',
        createdAt: '2026-10-05T10:00:00.000Z',
      });
      const fromListener = toGuestMessageDto(
        message({
          senderRole: HelplineSenderRole.LISTENER,
          senderUserId: 42,
          clientMessageId: 'staff-c',
          metadata: {
            fromSuggestion: { messageId: 3, index: 0, editedDistance: 2 },
          },
        }),
      );
      expect(fromListener.from).toBe('LISTENER');
      expect(fromListener.clientMessageId).toBeNull();
      expect(fromListener).not.toHaveProperty('senderUserId');
      expect(fromListener).not.toHaveProperty('metadata');
      expect(fromListener).not.toHaveProperty('visibleToTalker');

      const accepted = toGuestMessageDto(
        message({
          type: HelplineMessageType.SYSTEM,
          senderRole: HelplineSenderRole.SYSTEM,
          systemKind: HelplineGuestSystemKind.ACCEPTED,
          metadata: { params: { listenerName: 'Ravi' }, internal: 'x' },
        }),
      );
      expect(accepted.from).toBe('SERVICE');
      expect(accepted.params).toEqual({ listenerName: 'Ravi' });
    });

    it('toGuestMessageDtos filters staff-only rows out of a mixed transcript', () => {
      const rows = [
        message({ id: 1 }),
        message({
          id: 2,
          type: HelplineMessageType.RISK,
          visibleToTalker: false,
        }),
        message({
          id: 3,
          type: HelplineMessageType.WHISPER,
          visibleToTalker: false,
        }),
        message({ id: 4, senderRole: HelplineSenderRole.LISTENER }),
      ];
      expect(toGuestMessageDtos(rows).map((m) => m.id)).toEqual([1, 4]);
    });
  });

  describe('planMessageEmits (realtime routing)', () => {
    it.each(STAFF_ONLY_TYPES)(
      'sends a %s row to the staff room only',
      (type) => {
        const plans = planMessageEmits(
          message({ type, visibleToTalker: false }),
          null,
        );
        expect(plans.map((p) => p.room)).toEqual([`staff:${CHAT}`]);
      },
    );

    it('sends a talker-visible TEXT row to both rooms, guest DTO to the talker room', () => {
      const plans = planMessageEmits(
        message({ senderRole: HelplineSenderRole.LISTENER }),
        'Ravi',
      );
      expect(plans.map((p) => p.room)).toEqual([
        `staff:${CHAT}`,
        `talker:${CHAT}`,
      ]);
      const talkerPayload = plans[1].payload as {
        message: Record<string, unknown>;
      };
      expect(talkerPayload.message).not.toHaveProperty('visibleToTalker');
      const staffPayload = plans[0].payload as {
        message: Record<string, unknown>;
      };
      expect(staffPayload.message.senderName).toBe('Ravi');
    });
  });

  describe('talkerRoomViolation (last check before a talker socket)', () => {
    const talkerRoom = `talker:${CHAT}`;

    it.each([
      HelplineServerEvents.RISK_FLAGGED,
      HelplineServerEvents.WHISPER,
      HelplineServerEvents.SUGGESTIONS,
      HelplineServerEvents.NUDGE,
      HelplineServerEvents.SUMMARY_UPDATED,
      HelplineServerEvents.QUEUE_UPDATED,
      HelplineServerEvents.ALERT,
    ])('refuses the staff-only event %s', (event) => {
      expect(talkerRoomViolation(talkerRoom, event, {})).not.toBeNull();
    });

    it('refuses a staff DTO in MESSAGE_RECEIVED', () => {
      const staffDto = toStaffMessageDto(message({}), null);
      expect(
        talkerRoomViolation(talkerRoom, HelplineServerEvents.MESSAGE_RECEIVED, {
          chatId: CHAT,
          message: staffDto,
        }),
      ).toMatch(/staff DTO/);
    });

    it('refuses a guest-shaped payload of a staff-only type', () => {
      expect(
        talkerRoomViolation(talkerRoom, HelplineServerEvents.MESSAGE_RECEIVED, {
          message: {
            id: 1,
            from: 'SERVICE',
            type: HelplineMessageType.RISK,
            content: 'x',
          },
        }),
      ).toMatch(/staff-only/);
    });

    it('refuses a StaffChatDto in CHAT_UPDATED', () => {
      expect(
        talkerRoomViolation(talkerRoom, HelplineServerEvents.CHAT_UPDATED, {
          chat: { id: CHAT, myAccess: 'LISTENER', talker: {} },
        }),
      ).not.toBeNull();
    });

    it('allows a guest DTO, and leaves staff rooms alone', () => {
      const guest = toGuestMessageDto(message({}));
      expect(
        talkerRoomViolation(talkerRoom, HelplineServerEvents.MESSAGE_RECEIVED, {
          chatId: CHAT,
          message: guest,
        }),
      ).toBeNull();
      expect(
        talkerRoomViolation(`staff:${CHAT}`, HelplineServerEvents.WHISPER, {}),
      ).toBeNull();
    });
  });

  describe('HelplineRealtimeService', () => {
    const publish = jest.fn().mockResolvedValue(undefined);
    const service = new HelplineRealtimeService({
      publish,
      subscribe: jest.fn(),
    } as never);

    beforeEach(() => publish.mockClear());

    it('never publishes a WHISPER, SUGGESTION or RISK row to the talker room', async () => {
      for (const type of [
        HelplineMessageType.WHISPER,
        HelplineMessageType.SUGGESTION,
        HelplineMessageType.RISK,
      ]) {
        await service.emitMessage(
          message({ type, visibleToTalker: false }),
          null,
        );
      }
      const rooms = publish.mock.calls.map(([, envelope]) => envelope.room);
      expect(rooms.every((room: string) => room.startsWith('staff:'))).toBe(
        true,
      );
      expect(rooms).toHaveLength(3);
    });

    it('drops (does not publish) an emit that would leak to a talker room', async () => {
      await service.emit(`talker:${CHAT}`, HelplineServerEvents.RISK_FLAGGED, {
        flag: {},
      });
      await service.emit(
        `talker:${CHAT}`,
        HelplineServerEvents.MESSAGE_RECEIVED,
        {
          message: toStaffMessageDto(message({}), null),
        },
      );
      expect(publish).not.toHaveBeenCalled();
    });

    it('publishes on the helpline broker channel', async () => {
      await service.emit(`staff:${CHAT}`, HelplineServerEvents.WHISPER, {
        ok: 1,
      });
      expect(publish).toHaveBeenCalledWith(
        MessageBrokerChannel.HELPLINE_SOCKET_EMIT,
        {
          op: 'emit',
          room: `staff:${CHAT}`,
          event: HelplineServerEvents.WHISPER,
          payload: { ok: 1 },
        },
      );
    });
  });

  it('editDistance is a Levenshtein distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });
});
