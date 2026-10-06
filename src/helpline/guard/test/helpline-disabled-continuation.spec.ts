import { HttpException } from '@nestjs/common';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import { HelplineChatStatus } from '../../constants/helpline.constants';
import { HelplineChatGateway } from '../../gateway/helpline-chat.gateway';
import { HelplineSocketAuthService } from '../../gateway/helpline-socket-auth.service';
import {
  HELPLINE_DISABLED_GRACE_MS,
  HelplineChatScopedGuard,
  HelplineEnabledOrContinuingGuard,
  listenerMayContinue,
} from '../helpline-enabled.guard';

/**
 * Contract §5.4: switching the org's helpline off refuses new work (sessions,
 * lobby, claim, Available, monitor) but never cuts the listener of record off
 * mid-conversation — they keep that one chat until it ends.
 */
const TENANT = { id: 't-uuid', code: 'acme', name: 'Acme', logoUrl: null };
const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const LISTENER = 7;
const SUPERVISOR = 9;

const chat = (o: Record<string, unknown> = {}) => ({
  id: CHAT_ID,
  tenantId: TENANT.id,
  status: HelplineChatStatus.ACTIVE,
  listenerId: LISTENER,
  previousListenerIds: [],
  endedAt: null,
  ...o,
});

const errorCode = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return ((e as HttpException).getResponse() as { errorCode?: string })
      .errorCode;
  }
  return 'passed';
};

describe('listenerMayContinue', () => {
  const now = new Date('2026-10-06T10:00:00Z');
  it('the listener of record of an ACTIVE chat continues', () => {
    expect(listenerMayContinue(chat() as never, LISTENER, now)).toBe(true);
  });
  it('nobody else does — not a supervisor, not a previous listener', () => {
    expect(listenerMayContinue(chat() as never, SUPERVISOR, now)).toBe(false);
    expect(
      listenerMayContinue(
        chat({ previousListenerIds: [SUPERVISOR] }) as never,
        SUPERVISOR,
        now,
      ),
    ).toBe(false);
    expect(listenerMayContinue(null, LISTENER, now)).toBe(false);
  });
  it('a WAITING chat is new work: refused', () => {
    expect(
      listenerMayContinue(
        chat({ status: HelplineChatStatus.WAITING, listenerId: null }) as never,
        LISTENER,
        now,
      ),
    ).toBe(false);
  });
  it('after the end, only within the grace period (to save the summary)', () => {
    const endedAt = (msAgo: number) => new Date(now.getTime() - msAgo);
    expect(
      listenerMayContinue(
        chat({
          status: HelplineChatStatus.ENDED,
          endedAt: endedAt(HELPLINE_DISABLED_GRACE_MS - 1000),
        }) as never,
        LISTENER,
        now,
      ),
    ).toBe(true);
    expect(
      listenerMayContinue(
        chat({
          status: HelplineChatStatus.ENDED,
          endedAt: endedAt(HELPLINE_DISABLED_GRACE_MS + 1000),
        }) as never,
        LISTENER,
        now,
      ),
    ).toBe(false);
  });
});

describe('HelplineChatScopedGuard', () => {
  const build = (enabled: boolean, chatRow: unknown) => {
    const chats = { findById: jest.fn().mockResolvedValue(chatRow) };
    const guard = new HelplineChatScopedGuard(
      { isEnabledForTenant: jest.fn().mockResolvedValue(enabled) } as never,
      { resolve: jest.fn().mockResolvedValue(TENANT) } as never,
      chats as never,
    );
    const run = (userId: number, params: Record<string, string>) => {
      const request: Record<string, unknown> = {
        user: { id: userId, tenantId: 'acme' },
        params,
      };
      return {
        request,
        result: guard.canActivate({
          switchToHttp: () => ({ getRequest: () => request }),
        } as never),
      };
    };
    return { run, chats };
  };

  it('enabled: behaves exactly like the plain gate (no chat lookup)', async () => {
    const { run, chats } = build(true, null);
    const { request, result } = run(SUPERVISOR, { id: CHAT_ID });
    await expect(result).resolves.toBe(true);
    expect(request.helplineTenant).toBe(TENANT);
    expect(chats.findById).not.toHaveBeenCalled();
  });

  it('disabled: the listener of record of the ACTIVE chat passes, loaded tenant-scoped', async () => {
    const { run, chats } = build(false, chat());
    const { request, result } = run(LISTENER, { id: CHAT_ID });
    await expect(result).resolves.toBe(true);
    expect(chats.findById).toHaveBeenCalledWith(TENANT.id, CHAT_ID);
    expect(request.helplineTenant).toBe(TENANT);
  });

  it('disabled: a supervisor (or anyone else) gets HELPLINE_DISABLED', async () => {
    const { run } = build(false, chat());
    expect(await errorCode(run(SUPERVISOR, { id: CHAT_ID }).result)).toBe(
      ErrorCode.HELPLINE_DISABLED,
    );
  });

  it('disabled: no chat id, a bad id or an unknown chat is HELPLINE_DISABLED', async () => {
    expect(await errorCode(build(false, chat()).run(LISTENER, {}).result)).toBe(
      ErrorCode.HELPLINE_DISABLED,
    );
    expect(
      await errorCode(build(false, chat()).run(LISTENER, { id: 'x' }).result),
    ).toBe(ErrorCode.HELPLINE_DISABLED);
    expect(
      await errorCode(build(false, null).run(LISTENER, { id: CHAT_ID }).result),
    ).toBe(ErrorCode.HELPLINE_DISABLED);
  });
});

describe('socket handshake while disabled', () => {
  const build = (enabled: boolean, active: unknown[]) => {
    const chats = {
      listActiveForListener: jest.fn().mockResolvedValue(active),
    };
    const service = new HelplineSocketAuthService(
      { looksLikeGuestToken: () => false } as never,
      {
        webSocketMiddleware:
          () =>
          (socket: { data: Record<string, unknown> }, next: () => void) => {
            socket.data.user = { id: LISTENER, tenantId: 'acme' };
            next();
          },
      } as never,
      {
        getUserPermissions: jest
          .fn()
          .mockResolvedValue([
            PERMISSIONS.VIEW_HELPLINE_LOBBY,
            PERMISSIONS.VIEW_HELPLINE_MONITOR,
          ]),
      } as never,
      { isEnabledForTenant: jest.fn().mockResolvedValue(enabled) } as never,
      { resolve: jest.fn().mockResolvedValue(TENANT) } as never,
      {} as never,
      chats as never,
      {} as never,
    );
    const socket = { handshake: { auth: { token: 'user-jwt' } }, data: {} };
    return { authenticate: () => service.authenticate(socket as never) };
  };

  it('enabled: an ordinary staff socket', async () => {
    const ctx = await build(true, []).authenticate();
    expect(ctx).toMatchObject({ kind: 'staff', userId: LISTENER });
    expect((ctx as { restricted?: boolean }).restricted).toBeUndefined();
  });

  it('disabled with an ACTIVE chat of record: a restricted socket', async () => {
    const ctx = await build(false, [chat()]).authenticate();
    expect(ctx).toMatchObject({
      kind: 'staff',
      userId: LISTENER,
      tenantId: TENANT.id,
      restricted: true,
    });
  });

  it('disabled with nothing to finish: refused', async () => {
    await expect(build(false, []).authenticate()).rejects.toThrow(/disabled/);
  });
});

describe('gateway while disabled', () => {
  const build = (enabled: boolean, chatRow: unknown, permissions: string[]) => {
    const connection = {
      staffConnected: jest.fn().mockResolvedValue([CHAT_ID]),
    };
    const listeners = { setPresence: jest.fn().mockResolvedValue('AWAY') };
    const gateway = new HelplineChatGateway(
      {} as never,
      {} as never,
      { findById: jest.fn().mockResolvedValue(chatRow) } as never,
      {} as never,
      {} as never,
      {} as never,
      listeners as never,
      connection as never,
      { touchConnection: jest.fn().mockResolvedValue(undefined) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(permissions) } as never,
      { resolve: jest.fn().mockResolvedValue(TENANT) } as never,
      {} as never,
      { isEnabledForTenant: jest.fn().mockResolvedValue(enabled) } as never,
    );
    return { gateway, listeners, connection };
  };
  const staffSocket = (userId: number, restricted = false) => ({
    id: `sock-${userId}`,
    data: {
      helpline: {
        kind: 'staff',
        userId,
        tenantId: TENANT.id,
        permissions: [
          PERMISSIONS.VIEW_HELPLINE_LOBBY,
          PERMISSIONS.VIEW_HELPLINE_MONITOR,
        ],
        ...(restricted ? { restricted: true } : {}),
      },
    },
    join: jest.fn().mockResolvedValue(undefined),
  });

  it('a restricted socket joins its user room and its chats only — no lobby, no supervisors', async () => {
    const { gateway } = build(false, chat(), []);
    const socket = staffSocket(LISTENER, true);
    await gateway.handleConnection(socket as never);
    const joined = socket.join.mock.calls.flatMap(([r]) =>
      Array.isArray(r) ? r : [r],
    );
    expect(joined.sort()).toEqual(
      [`staff:${CHAT_ID}`, `user:${LISTENER}`].sort(),
    );
  });

  it('an unrestricted socket still joins lobby and supervisors (and rejoins its chats on reconnect)', async () => {
    const { gateway, connection } = build(true, chat(), []);
    const socket = staffSocket(LISTENER);
    await gateway.handleConnection(socket as never);
    const joined = socket.join.mock.calls.flatMap(([r]) =>
      Array.isArray(r) ? r : [r],
    );
    expect(joined).toEqual(
      expect.arrayContaining([
        `user:${LISTENER}`,
        `lobby:${TENANT.id}`,
        `supervisors:${TENANT.id}`,
        `staff:${CHAT_ID}`,
      ]),
    );
    expect(connection.staffConnected).toHaveBeenCalled();
  });

  it('JOIN_CHAT: the listener of record may; a monitoring supervisor may not', async () => {
    const monitor = [PERMISSIONS.VIEW_HELPLINE_MONITOR];
    await expect(
      build(false, chat(), monitor).gateway.onJoinChat(
        staffSocket(LISTENER) as never,
        { chatId: CHAT_ID },
      ),
    ).resolves.toEqual({ ok: true, access: 'LISTENER' });
    await expect(
      build(false, chat(), monitor).gateway.onJoinChat(
        staffSocket(SUPERVISOR) as never,
        { chatId: CHAT_ID },
      ),
    ).resolves.toEqual({ ok: false, error: 'not_found' });
    // …and the same supervisor may again once the helpline is on.
    await expect(
      build(true, chat(), monitor).gateway.onJoinChat(
        staffSocket(SUPERVISOR) as never,
        { chatId: CHAT_ID },
      ),
    ).resolves.toEqual({ ok: true, access: 'READ_ONLY' });
  });

  it('PRESENCE_SET: Available is refused while disabled, Away is allowed', async () => {
    const perms = [PERMISSIONS.EDIT_HELPLINE_PRESENCE];
    const { gateway, listeners } = build(false, chat(), perms);
    await expect(
      gateway.onPresenceSet(staffSocket(LISTENER) as never, {
        status: 'AVAILABLE',
      }),
    ).resolves.toEqual({ ok: false, error: 'not_allowed' });
    expect(listeners.setPresence).not.toHaveBeenCalled();
    await expect(
      gateway.onPresenceSet(staffSocket(LISTENER) as never, {
        status: 'AWAY',
      }),
    ).resolves.toEqual({ ok: true, presence: 'AWAY' });
  });
});

describe('HelplineEnabledOrContinuingGuard (GET me)', () => {
  const build = (enabled: boolean, activeChats: unknown[]) => {
    const chats = {
      listActiveForListener: jest.fn().mockResolvedValue(activeChats),
    };
    const guard = new HelplineEnabledOrContinuingGuard(
      { isEnabledForTenant: jest.fn().mockResolvedValue(enabled) } as never,
      { resolve: jest.fn().mockResolvedValue(TENANT) } as never,
      chats as never,
    );
    const run = (userId: number) => {
      const request: Record<string, unknown> = {
        user: { id: userId, tenantId: 'acme' },
      };
      return {
        request,
        result: guard.canActivate({
          switchToHttp: () => ({ getRequest: () => request }),
        } as never),
      };
    };
    return { run, chats };
  };

  it('enabled: passes without looking at chats', async () => {
    const { run, chats } = build(true, []);
    const { request, result } = run(SUPERVISOR);
    await expect(result).resolves.toBe(true);
    expect(request.helplineTenant).toBe(TENANT);
    expect(chats.listActiveForListener).not.toHaveBeenCalled();
  });

  it('disabled: a listener still holding an ACTIVE chat passes, tenant-scoped', async () => {
    const { run, chats } = build(false, [chat()]);
    const { request, result } = run(LISTENER);
    await expect(result).resolves.toBe(true);
    expect(chats.listActiveForListener).toHaveBeenCalledWith(
      TENANT.id,
      LISTENER,
    );
    expect(request.helplineTenant).toBe(TENANT);
  });

  it('disabled: anyone without an active chat gets HELPLINE_DISABLED', async () => {
    const { run } = build(false, []);
    expect(await errorCode(run(SUPERVISOR).result)).toBe(
      ErrorCode.HELPLINE_DISABLED,
    );
  });
});
