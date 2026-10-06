import { HttpException } from '@nestjs/common';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  HelplineAccess,
  HelplineChatStatus,
  HelplineEndedReason,
} from '../../constants/helpline.constants';
import { HelplineListenerService } from '../helpline-listener.service';

const TENANT = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };
const CHAT_ID = '11111111-1111-4111-8111-111111111111';

function build(chatRow: unknown, permissions: string[]) {
  const chats = { findById: jest.fn().mockResolvedValue(chatRow) };
  const perms = {
    getUserPermissions: jest.fn().mockResolvedValue(permissions),
  };
  const views = { chatDetail: jest.fn().mockResolvedValue({}) };
  const lifecycle = { endChat: jest.fn().mockResolvedValue(chatRow) };
  const service = new HelplineListenerService(
    chats as never,
    {} as never,
    perms as never,
    {} as never,
    {} as never,
    {} as never,
    views as never,
    {} as never,
    {} as never,
    lifecycle as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, chats, views, lifecycle };
}

const chat = (o: Record<string, unknown> = {}) => ({
  id: CHAT_ID,
  tenantId: TENANT.id,
  status: HelplineChatStatus.ACTIVE,
  listenerId: 7,
  previousListenerIds: [3],
  ...o,
});

const statusOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    const e = error as HttpException;
    return [
      e.getStatus(),
      (e.getResponse() as { errorCode?: string }).errorCode,
    ];
  }
  return 'ok';
};

describe('HelplineListenerService access rule', () => {
  it.each([
    ['listener of record', 7, [], HelplineAccess.LISTENER],
    ['previous listener', 3, [], HelplineAccess.READ_ONLY],
    [
      'monitoring supervisor',
      50,
      [PERMISSIONS.VIEW_HELPLINE_MONITOR],
      HelplineAccess.READ_ONLY,
    ],
  ])('%s → %s', async (_, userId, permissions, access) => {
    const { service } = build(chat(), permissions as string[]);
    const result = await service.loadChat(TENANT, CHAT_ID, {
      id: userId as number,
      tenantId: TENANT.id,
    });
    expect(result.access).toBe(access);
  });

  it('a stranger gets 404, not 403 — existence is never confirmed', async () => {
    const { service } = build(chat(), [PERMISSIONS.VIEW_HELPLINE_CHAT]);
    expect(
      await statusOf(
        service.loadChat(TENANT, CHAT_ID, { id: 99, tenantId: TENANT.id }),
      ),
    ).toEqual([404, ErrorCode.HELPLINE_CHAT_NOT_FOUND]);
  });

  it('a chat of another tenant is not found (the load is tenant-scoped)', async () => {
    const { service, chats } = build(null, [PERMISSIONS.VIEW_HELPLINE_MONITOR]);
    expect(
      await statusOf(
        service.loadChat(TENANT, CHAT_ID, { id: 7, tenantId: TENANT.id }),
      ),
    ).toEqual([404, ErrorCode.HELPLINE_CHAT_NOT_FOUND]);
    expect(chats.findById).toHaveBeenCalledWith(TENANT.id, CHAT_ID);
  });

  it('the listener ends as LISTENER_ENDED; a supervisor as SUPERVISOR_ENDED; a previous listener may not', async () => {
    const listener = build(chat(), []);
    await listener.service.endChat(TENANT, CHAT_ID, {
      id: 7,
      tenantId: TENANT.id,
    });
    expect(listener.lifecycle.endChat).toHaveBeenCalledWith(
      expect.anything(),
      HelplineEndedReason.LISTENER_ENDED,
      7,
    );

    const supervisor = build(chat(), [
      PERMISSIONS.VIEW_HELPLINE_MONITOR,
      PERMISSIONS.EDIT_HELPLINE_TRANSFER,
    ]);
    await supervisor.service.endChat(TENANT, CHAT_ID, {
      id: 50,
      tenantId: TENANT.id,
    });
    expect(supervisor.lifecycle.endChat).toHaveBeenCalledWith(
      expect.anything(),
      HelplineEndedReason.SUPERVISOR_ENDED,
      50,
    );

    const previous = build(chat(), []);
    expect(
      await statusOf(
        previous.service.endChat(TENANT, CHAT_ID, {
          id: 3,
          tenantId: TENANT.id,
        }),
      ),
    ).toEqual([403, ErrorCode.HELPLINE_NOT_LISTENER]);
  });

  it('ending an ended chat is a no-op that returns it', async () => {
    const { service, lifecycle, views } = build(
      chat({ status: HelplineChatStatus.ENDED }),
      [],
    );
    await service.endChat(TENANT, CHAT_ID, { id: 7, tenantId: TENANT.id });
    expect(lifecycle.endChat).not.toHaveBeenCalled();
    expect(views.chatDetail).toHaveBeenCalled();
  });
});

type Twelve = [
  never,
  never,
  never,
  never,
  never,
  never,
  never,
  never,
  never,
  never,
  never,
  never,
];

describe('HelplineListenerService.copilotFeedback', () => {
  const build = (row: unknown) => {
    const messages = {
      findById: jest.fn().mockResolvedValue(row),
      setCopilotFeedback: jest.fn().mockResolvedValue(true),
    };
    const service = new HelplineListenerService(
      {
        findById: jest.fn().mockResolvedValue({
          id: CHAT_ID,
          tenantId: TENANT.id,
          listenerId: 7,
          previousListenerIds: [],
        }),
      } as never,
      messages as never,
      {
        getUserPermissions: jest
          .fn()
          .mockResolvedValue([PERMISSIONS.VIEW_HELPLINE_COPILOT]),
      } as never,
      ...(Array(12).fill({}) as Twelve),
    );
    return { service, messages };
  };
  const user = { id: 7, tenantId: TENANT.id };
  const suggestion = {
    id: 12,
    type: 'SUGGESTION',
    metadata: { suggestions: [{ index: 0 }, { index: 1 }] },
  };

  it('stores a SUGGESTION rating under its index', async () => {
    const { service, messages } = build(suggestion);
    await service.copilotFeedback(TENANT, CHAT_ID, user, {
      messageId: 12,
      index: 1,
      rating: 'DOWN',
    });
    expect(messages.setCopilotFeedback).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      12,
      'SUGGESTION',
      1,
      'DOWN',
    );
  });

  it('a SUGGESTION needs a real index (400)', async () => {
    const { service } = build(suggestion);
    await expect(
      service.copilotFeedback(TENANT, CHAT_ID, user, {
        messageId: 12,
        index: 5,
        rating: 'UP',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('a NUDGE rating ignores the index', async () => {
    const { service, messages } = build({
      id: 13,
      type: 'NUDGE',
      metadata: {},
    });
    await service.copilotFeedback(TENANT, CHAT_ID, user, {
      messageId: 13,
      rating: 'UP',
    });
    expect(messages.setCopilotFeedback).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      13,
      'NUDGE',
      null,
      'UP',
    );
  });

  it('any other row is a 404 — a talker message cannot be rated', async () => {
    const { service, messages } = build({
      id: 14,
      type: 'TEXT',
      metadata: null,
    });
    await expect(
      service.copilotFeedback(TENANT, CHAT_ID, user, {
        messageId: 14,
        rating: 'UP',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(messages.setCopilotFeedback).not.toHaveBeenCalled();
  });
});
