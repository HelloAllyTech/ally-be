import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { HelplineServerEvents } from '../../constants/helpline.constants';
import { HelplineSendRefused } from '../../service/helpline-message.service';
import { HelplineChatGateway, ackErrorFor } from '../helpline-chat.gateway';

const CHAT = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

function build() {
  const emitted: { room: string; except?: string; event: string }[] = [];
  const joins: { target: string; room: string }[] = [];
  const server = {
    to: (room: string) => {
      const op = {
        except: (except: string) => ({
          emit: (event: string) => emitted.push({ room, except, event }),
        }),
        emit: (event: string) => emitted.push({ room, event }),
      };
      return op;
    },
    in: (target: string) => ({
      socketsJoin: (room: string) => joins.push({ target, room }),
      socketsLeave: jest.fn(),
      disconnectSockets: jest.fn(),
    }),
  };
  const chats = { findForGuest: jest.fn(), findById: jest.fn() };
  const gateway = new HelplineChatGateway(
    {} as never,
    {} as never,
    chats as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { getUserPermissions: jest.fn().mockResolvedValue([]) } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  gateway.server = server as never;
  return { gateway, emitted, joins, chats };
}

const talkerSocket = () =>
  ({
    id: 'sock-1',
    data: {
      helpline: {
        kind: 'talker',
        talkerId: 'tk',
        chatId: CHAT,
        tenantId: 't-1',
        talkerName: 'Asha',
      },
    },
    join: jest.fn(),
  }) as never;

describe('HelplineChatGateway', () => {
  it('a talker cannot JOIN any chat room', async () => {
    const { gateway } = build();
    const socket = talkerSocket();
    await expect(
      gateway.onJoinChat(socket, { chatId: OTHER }),
    ).resolves.toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect((socket as { join: jest.Mock }).join).not.toHaveBeenCalled();
  });

  it('a talker cannot send to, or sync, another chat', async () => {
    const { gateway, chats } = build();
    await expect(
      gateway.onSendMessage(talkerSocket(), {
        chatId: OTHER,
        content: 'hi',
        clientMessageId: undefined,
      }),
    ).resolves.toEqual({ ok: false, error: 'not_allowed' });
    await expect(
      gateway.onSyncSince(talkerSocket(), { chatId: OTHER, afterId: 0 }),
    ).resolves.toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(chats.findForGuest).not.toHaveBeenCalled();
  });

  it('rate limits a socket: burst of 5, then rate_limited', async () => {
    const { gateway, chats } = build();
    chats.findForGuest.mockResolvedValue(null);
    const socket = talkerSocket();
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(
        await gateway.onSendMessage(socket, { chatId: CHAT, content: 'hi' }),
      );
    }
    expect(
      results
        .slice(0, 5)
        .every((r) => r.ok === false && r.error === 'not_allowed'),
    ).toBe(true);
    expect(results[5]).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('an exception in a handler becomes an ack, never a crash', async () => {
    const { gateway, chats } = build();
    chats.findForGuest.mockRejectedValue(new Error('db exploded'));
    await expect(
      gateway.onSendMessage(talkerSocket(), { chatId: CHAT, content: 'hi' }),
    ).resolves.toEqual({
      ok: false,
      error: 'internal_error',
    });
  });

  it('a socket with no handshake identity is refused', async () => {
    const { gateway } = build();
    await expect(
      gateway.onHeartbeat({ id: 'x', data: {} } as never),
    ).resolves.toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });

  describe('applyEnvelope (local delivery of broker messages)', () => {
    it('re-checks the talker-room guard before emitting locally', () => {
      const { gateway, emitted } = build();
      gateway.applyEnvelope({
        op: 'emit',
        room: `talker:${CHAT}`,
        event: HelplineServerEvents.WHISPER,
        payload: {},
      });
      gateway.applyEnvelope({
        op: 'emit',
        room: `talker:${CHAT}`,
        event: HelplineServerEvents.MESSAGE_RECEIVED,
        payload: { message: { id: 1, type: 'RISK', visibleToTalker: false } },
      });
      expect(emitted).toEqual([]);
    });

    it('delivers staff emits, honours `except`, and applies cross-replica joins', () => {
      const { gateway, emitted, joins } = build();
      gateway.applyEnvelope({
        op: 'emit',
        room: `staff:${CHAT}`,
        event: HelplineServerEvents.CHAT_UPDATED,
        payload: {},
        except: 'user:7',
      });
      gateway.applyEnvelope({
        op: 'join',
        target: 'user:7',
        room: `staff:${CHAT}`,
      });
      expect(emitted).toEqual([
        {
          room: `staff:${CHAT}`,
          except: 'user:7',
          event: HelplineServerEvents.CHAT_UPDATED,
        },
      ]);
      expect(joins).toEqual([{ target: 'user:7', room: `staff:${CHAT}` }]);
    });

    it('ignores rooms outside the helpline namespace’s scheme', () => {
      const { gateway, emitted } = build();
      gateway.applyEnvelope({
        op: 'emit',
        room: 'everyone',
        event: 'X',
        payload: {},
      });
      expect(emitted).toEqual([]);
    });
  });

  it('maps refusals and errors to ack strings', () => {
    expect(ackErrorFor(new HelplineSendRefused('too_long'))).toBe('too_long');
    expect(
      ackErrorFor(
        new HttpException(
          { errorCode: ErrorCode.HELPLINE_CHAT_NOT_FOUND },
          HttpStatus.NOT_FOUND,
        ),
      ),
    ).toBe('not_found');
    expect(ackErrorFor(new HttpException('bad', HttpStatus.BAD_REQUEST))).toBe(
      'invalid',
    );
    expect(ackErrorFor(new Error('x'))).toBe('internal_error');
  });
});
