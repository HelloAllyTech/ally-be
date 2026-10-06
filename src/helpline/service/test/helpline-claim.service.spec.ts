import { HttpException } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineGuestSystemKind,
  HelplineServerEvents,
} from '../../constants/helpline.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import { HelplineChatRepository } from '../../repository/helpline-chat.repository';
import { HelplineClaimService } from '../helpline-claim.service';

const TENANT = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };
const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const ME = 7;

const chat = (o: Record<string, unknown> = {}) => ({
  id: CHAT_ID,
  tenantId: TENANT.id,
  talkerId: 'talker-1',
  status: HelplineChatStatus.WAITING,
  listenerId: null,
  previousListenerIds: [],
  transferTargetListenerId: null,
  ...o,
});

function build(
  o: {
    before?: unknown;
    available?: boolean;
    capacity?: number;
    active?: number;
    won?: boolean;
  } = {},
) {
  const chats = {
    findById: jest
      .fn()
      .mockResolvedValueOnce(o.before === undefined ? chat() : o.before)
      .mockResolvedValue(
        chat({ status: HelplineChatStatus.ACTIVE, listenerId: ME }),
      ),
    countActiveForListener: jest.fn().mockResolvedValue(o.active ?? 0),
    claim: jest.fn().mockResolvedValue(o.won ?? true),
  };
  const presence = {
    isAvailable: jest.fn().mockResolvedValue(o.available ?? true),
  };
  const profiles = {
    capacity: jest.fn().mockResolvedValue(o.capacity ?? 2),
    aliases: jest.fn().mockResolvedValue(new Map([[ME, 'Ravi']])),
  };
  const settings = {
    getSettings: jest.fn().mockResolvedValue(HELPLINE_DEFAULT_SETTINGS),
  };
  const writer = {
    system: jest.fn().mockResolvedValue({}),
    staffOnly: jest.fn().mockResolvedValue({}),
  };
  const events = { record: jest.fn().mockResolvedValue(undefined) };
  const views = {
    guestChat: jest.fn().mockResolvedValue({ id: CHAT_ID }),
    chatDetail: jest.fn().mockResolvedValue({ chat: { id: CHAT_ID } }),
  };
  const notify = {
    chatUpdated: jest.fn().mockResolvedValue(undefined),
    presenceUpdated: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { queueChanged: jest.fn() };
  const realtime = {
    joinUser: jest.fn().mockResolvedValue(undefined),
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const copilot = { onChatClaimed: jest.fn() };
  const service = new HelplineClaimService(
    chats as never,
    presence as never,
    profiles as never,
    settings as never,
    writer as never,
    events as never,
    views as never,
    notify as never,
    queue as never,
    realtime as never,
    copilot as never,
  );
  return { service, chats, presence, writer, events, realtime, queue, copilot };
}

const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return ((error as HttpException).getResponse() as { errorCode?: string })
      .errorCode;
  }
  return 'no error';
};

describe('HelplineClaimService', () => {
  it('zero rows from the atomic UPDATE → HELPLINE_ALREADY_CLAIMED', async () => {
    const { service, writer } = build({ won: false });
    expect(await codeOf(service.claim(TENANT, CHAT_ID, ME))).toBe(
      ErrorCode.HELPLINE_ALREADY_CLAIMED,
    );
    expect(writer.system).not.toHaveBeenCalled();
  });

  it('refuses a listener who is not Available', async () => {
    const { service, chats } = build({ available: false });
    expect(await codeOf(service.claim(TENANT, CHAT_ID, ME))).toBe(
      ErrorCode.HELPLINE_NOT_AVAILABLE,
    );
    expect(chats.claim).not.toHaveBeenCalled();
  });

  it('refuses a listener at capacity (min of profile and org cap)', async () => {
    const { service, chats } = build({ capacity: 2, active: 2 });
    expect(await codeOf(service.claim(TENANT, CHAT_ID, ME))).toBe(
      ErrorCode.HELPLINE_AT_CAPACITY,
    );
    expect(chats.claim).not.toHaveBeenCalled();
  });

  it('an ended chat cannot be claimed', async () => {
    const { service } = build({
      before: chat({ status: HelplineChatStatus.ENDED }),
    });
    expect(await codeOf(service.claim(TENANT, CHAT_ID, ME))).toBe(
      ErrorCode.HELPLINE_ALREADY_CLAIMED,
    );
  });

  it('an unknown chat is a 404', async () => {
    const { service } = build({ before: null });
    expect(await codeOf(service.claim(TENANT, CHAT_ID, ME))).toBe(
      ErrorCode.HELPLINE_CHAT_NOT_FOUND,
    );
  });

  it('a chat aimed at another listener is claimed by nobody else (the UPDATE returns no row)', async () => {
    const { service, chats } = build({
      before: chat({ transferTargetListenerId: 99 }),
      won: false,
    });
    expect(await codeOf(service.claim(TENANT, CHAT_ID, ME))).toBe(
      ErrorCode.HELPLINE_ALREADY_CLAIMED,
    );
    expect(chats.claim).toHaveBeenCalledWith(TENANT.id, CHAT_ID, ME);
  });

  it('on success: joins the staff room, ACCEPTED to the talker, CLAIMED event, lobby + talker updates', async () => {
    const { service, writer, events, realtime, queue, copilot } = build();
    await service.claim(TENANT, CHAT_ID, ME);
    expect(realtime.joinUser).toHaveBeenCalledWith(ME, `staff:${CHAT_ID}`);
    expect(writer.system).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      HelplineGuestSystemKind.ACCEPTED,
      "You're now chatting with Ravi.",
      { visibleToTalker: true, params: { listenerName: 'Ravi' } },
    );
    expect(events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.CLAIMED,
      ME,
      { listenerId: ME },
    );
    expect(realtime.emit).toHaveBeenCalledWith(
      `talker:${CHAT_ID}`,
      HelplineServerEvents.CHAT_ACCEPTED,
      { chat: { id: CHAT_ID } },
    );
    expect(queue.queueChanged).toHaveBeenCalledWith(TENANT.id);
    expect(copilot.onChatClaimed).toHaveBeenCalled();
  });

  it('a transfer claim records TRANSFERRED from the previous listener', async () => {
    const { service, events } = build({
      before: chat({ status: HelplineChatStatus.ACTIVE, listenerId: 3 }),
    });
    await service.claim(TENANT, CHAT_ID, ME);
    expect(events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.TRANSFERRED,
      ME,
      { fromListenerId: 3, toListenerId: ME },
    );
  });

  it('a transfer claim writes a staff-only TRANSFERRED notice and emits TRANSFERRED to staff + lobby', async () => {
    const { service, writer, realtime } = build({
      before: chat({ status: HelplineChatStatus.ACTIVE, listenerId: 3 }),
    });
    await service.claim(TENANT, CHAT_ID, ME);
    expect(writer.staffOnly).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      'SYSTEM',
      'Transferred to Ravi.',
      { params: { listenerName: 'Ravi' } },
      expect.objectContaining({ systemKind: 'TRANSFERRED' }),
    );
    const transferred = realtime.emit.mock.calls.filter(
      ([, event]) => event === HelplineServerEvents.TRANSFERRED,
    );
    expect(transferred.map(([room]) => room).sort()).toEqual(
      [`lobby:${TENANT.id}`, `staff:${CHAT_ID}`].sort(),
    );
    expect(transferred[0][2]).toEqual({ chatId: CHAT_ID, toListenerId: ME });
  });

  it('a first claim writes no TRANSFERRED notice', async () => {
    const { service, writer, realtime } = build();
    await service.claim(TENANT, CHAT_ID, ME);
    expect(writer.staffOnly).not.toHaveBeenCalled();
    expect(
      realtime.emit.mock.calls.some(
        ([, event]) => event === HelplineServerEvents.TRANSFERRED,
      ),
    ).toBe(false);
  });
});

describe('HelplineChatRepository.claim (contract §6.6 SQL)', () => {
  const run = async (result: unknown) => {
    const repo = { query: jest.fn().mockResolvedValue(result) };
    const repository = new HelplineChatRepository(repo as never);
    const won = await repository.claim('t-1', CHAT_ID, ME);
    return {
      won,
      sql: repo.query.mock.calls[0][0] as string,
      params: repo.query.mock.calls[0][1],
    };
  };

  it('is one conditional UPDATE … RETURNING, scoped to the tenant', async () => {
    const { sql, params } = await run([[{ id: CHAT_ID }], 1]);
    expect(sql).toMatch(/^\s*UPDATE "helpline_chats"/);
    expect(sql).toContain('"tenant_id" = $2');
    expect(sql).toContain(`"status" = 'WAITING' AND "abandoned_at" IS NULL`);
    expect(sql).toContain(
      `"status" = 'ACTIVE' AND "transfer_requested_at" IS NOT NULL AND "listener_id" <> $3`,
    );
    expect(sql).toContain(
      '("transfer_target_listener_id" IS NULL OR "transfer_target_listener_id" = $3)',
    );
    expect(sql).toContain('"previous_listener_ids" || "listener_id"');
    // A claim after a take-over: the new listener is not a supervisor.
    expect(sql).toContain('"taken_over_at" = NULL');
    expect(sql).toContain('RETURNING');
    expect(params).toEqual([CHAT_ID, 't-1', ME]);
  });

  it('wins only when a row comes back', async () => {
    expect((await run([[{ id: CHAT_ID }], 1])).won).toBe(true);
    expect((await run([[], 0])).won).toBe(false);
  });
});
