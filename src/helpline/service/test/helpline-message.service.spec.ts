import {
  HelplineChatStatus,
  HelplineMessageType,
  HelplineSenderRole,
} from '../../constants/helpline.constants';
import {
  HelplineMessageService,
  HelplineSendRefused,
} from '../helpline-message.service';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const chat = (o: Record<string, unknown> = {}) =>
  ({
    id: CHAT_ID,
    tenantId: 't-1',
    status: HelplineChatStatus.ACTIVE,
    listenerId: 7,
    takenOverAt: null,
    ...o,
  }) as never;

function build(existing: unknown = null) {
  const stored = {
    id: 10,
    chatId: CHAT_ID,
    tenantId: 't-1',
    type: HelplineMessageType.TEXT,
  };
  const chats = {
    recordTalkerMessage: jest.fn().mockResolvedValue(1),
    recordListenerMessage: jest.fn().mockResolvedValue(undefined),
  };
  const messages = {
    findByClientMessageId: jest.fn().mockResolvedValue(existing),
    insert: jest.fn().mockResolvedValue(stored),
    findById: jest.fn().mockResolvedValue(null),
  };
  const writer = { emit: jest.fn().mockResolvedValue(undefined) };
  const risk = { screenTalkerMessage: jest.fn().mockResolvedValue(null) };
  const queue = { queueChanged: jest.fn() };
  const copilot = { onTalkerMessage: jest.fn(), onListenerMessage: jest.fn() };
  const service = new HelplineMessageService(
    chats as never,
    messages as never,
    writer as never,
    risk as never,
    queue as never,
    copilot as never,
  );
  return { service, chats, messages, writer, risk, queue, copilot, stored };
}

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof HelplineSendRefused ? error.reason : String(error);
  }
  return 'sent';
};

describe('HelplineMessageService', () => {
  describe('idempotent resend by clientMessageId', () => {
    it('returns the stored row and emits, screens and counts nothing', async () => {
      const existing = { id: 3, clientMessageId: CLIENT_ID };
      const { service, messages, writer, risk, chats } = build(existing);
      const result = await service.sendTalkerText(
        chat(),
        'hello again',
        CLIENT_ID,
        'Asha',
      );
      expect(result).toEqual({ message: existing, duplicate: true });
      expect(messages.findByClientMessageId).toHaveBeenCalledWith(
        't-1',
        CHAT_ID,
        CLIENT_ID,
      );
      expect(messages.insert).not.toHaveBeenCalled();
      expect(writer.emit).not.toHaveBeenCalled();
      expect(risk.screenTalkerMessage).not.toHaveBeenCalled();
      expect(chats.recordTalkerMessage).not.toHaveBeenCalled();
    });

    it('a concurrent duplicate (unique violation) returns the winner’s row', async () => {
      const { service, messages, writer } = build(null);
      const winner = { id: 4, clientMessageId: CLIENT_ID };
      messages.insert.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: '23505' }),
      );
      messages.findByClientMessageId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(winner);
      const result = await service.sendTalkerText(
        chat(),
        'hi',
        CLIENT_ID,
        'Asha',
      );
      expect(result).toEqual({ message: winner, duplicate: true });
      expect(writer.emit).not.toHaveBeenCalled();
    });

    it('stores the clientMessageId lower-cased', async () => {
      const { service, messages } = build(null);
      await service.sendTalkerText(
        chat(),
        'hi',
        CLIENT_ID.toUpperCase(),
        'Asha',
      );
      expect(messages.insert).toHaveBeenCalledWith(
        expect.objectContaining({ clientMessageId: CLIENT_ID }),
      );
    });
  });

  describe('talker sends', () => {
    it('persist → emit → count → keyword screen → copilot hook, talker-visible TEXT', async () => {
      const { service, messages, writer, risk, copilot, chats, stored } =
        build();
      const order: string[] = [];
      messages.insert.mockImplementation(
        async () => (order.push('persist'), stored),
      );
      writer.emit.mockImplementation(async () => void order.push('emit'));
      chats.recordTalkerMessage.mockImplementation(
        async () => (order.push('count'), 2),
      );
      risk.screenTalkerMessage.mockImplementation(
        async () => (order.push('screen'), null),
      );
      copilot.onTalkerMessage.mockImplementation(
        () => void order.push('copilot'),
      );

      await service.sendTalkerText(chat(), '  hello  ', CLIENT_ID, 'Asha');
      expect(order).toEqual(['persist', 'emit', 'count', 'screen', 'copilot']);
      expect(messages.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 't-1',
          senderRole: HelplineSenderRole.TALKER,
          type: HelplineMessageType.TEXT,
          content: 'hello',
          visibleToTalker: true,
        }),
      );
    });

    it('screens waiting-room messages too, and refreshes the lobby preview on the first one', async () => {
      const { service, risk, queue } = build();
      await service.sendTalkerText(
        chat({ status: HelplineChatStatus.WAITING }),
        'hi',
        null,
        null,
      );
      expect(risk.screenTalkerMessage).toHaveBeenCalled();
      expect(queue.queueChanged).toHaveBeenCalledWith('t-1');
    });

    it('refuses empty, too long, a bad clientMessageId, and an ended chat', async () => {
      const { service } = build();
      expect(
        await refusal(service.sendTalkerText(chat(), '   ', null, null)),
      ).toBe('empty');
      expect(
        await refusal(
          service.sendTalkerText(chat(), 'x'.repeat(2001), null, null),
        ),
      ).toBe('too_long');
      expect(
        await refusal(service.sendTalkerText(chat(), 'ok', 'not-a-uuid', null)),
      ).toBe('invalid');
      expect(
        await refusal(
          service.sendTalkerText(
            chat({ status: HelplineChatStatus.ENDED }),
            'ok',
            null,
            null,
          ),
        ),
      ).toBe('chat_ended');
    });

    it('a copilot hook that throws does not fail the send', async () => {
      const { service, copilot } = build();
      copilot.onTalkerMessage.mockImplementation(() => {
        throw new Error('boom');
      });
      await expect(
        service.sendTalkerText(chat(), 'hi', null, null),
      ).resolves.toBeDefined();
    });
  });

  describe('listener sends', () => {
    it('only the listener of record of an ACTIVE chat may send', async () => {
      const { service } = build();
      expect(
        await refusal(service.sendListenerText(chat(), 8, 'hi', null)),
      ).toBe('not_allowed');
      expect(
        await refusal(
          service.sendListenerText(
            chat({ status: HelplineChatStatus.WAITING }),
            7,
            'hi',
            null,
          ),
        ),
      ).toBe('not_allowed');
      expect(
        await refusal(
          service.sendListenerText(
            chat({ status: HelplineChatStatus.ENDED }),
            7,
            'hi',
            null,
          ),
        ),
      ).toBe('chat_ended');
    });

    it('sends as LISTENER, or SUPERVISOR after a take-over, and never screens staff text', async () => {
      const { service, messages, risk } = build();
      await service.sendListenerText(chat(), 7, 'hello', null);
      expect(messages.insert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          senderRole: HelplineSenderRole.LISTENER,
          senderUserId: 7,
        }),
      );
      await service.sendListenerText(
        chat({ takenOverAt: new Date() }),
        7,
        'hello',
        null,
      );
      expect(messages.insert).toHaveBeenLastCalledWith(
        expect.objectContaining({ senderRole: HelplineSenderRole.SUPERVISOR }),
      );
      expect(risk.screenTalkerMessage).not.toHaveBeenCalled();
    });

    it('records fromSuggestion with the edit distance when the suggestion resolves', async () => {
      const { service, messages } = build();
      messages.findById.mockResolvedValue({
        id: 5,
        type: HelplineMessageType.SUGGESTION,
        metadata: { suggestions: [{ index: 1, text: 'That sounds hard.' }] },
      });
      await service.sendListenerText(chat(), 7, 'That sounds so hard.', null, {
        messageId: 5,
        index: 1,
      });
      expect(messages.insert).toHaveBeenLastCalledWith(
        expect.objectContaining({
          metadata: {
            fromSuggestion: { messageId: 5, index: 1, editedDistance: 3 },
          },
        }),
      );
    });
  });
});
