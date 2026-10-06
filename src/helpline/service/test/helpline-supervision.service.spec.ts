import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ErrorCode } from 'src/exception/error-code.enum';
import {
  HelplineAccess,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineEndedReason,
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineSenderRole,
  HelplineServerEvents,
  HelplineStaffSystemKind,
} from '../../constants/helpline.constants';
import { HelplineChatRepository } from '../../repository/helpline-chat.repository';
import {
  planMessageEmits,
  talkerRoomViolation,
} from '../../util/helpline-serializers';
import {
  HelplineMessageService,
  HelplineSendRefused,
} from '../helpline-message.service';
import { HelplineRealtimeService } from '../helpline-realtime.service';
import { HelplineSupervisionService } from '../helpline-supervision.service';

const TENANT = { id: 't-uuid', code: 'acme', name: 'Acme', logoUrl: null };
const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const TALKER_ID = '22222222-2222-4222-8222-222222222222';
const LISTENER = 7;
const OTHER_LISTENER = 8;
const SUPERVISOR = 9;

const LISTENER_PERMS = [
  PERMISSIONS.VIEW_HELPLINE_LOBBY,
  PERMISSIONS.VIEW_HELPLINE_CHAT,
  PERMISSIONS.EDIT_HELPLINE_END,
  PERMISSIONS.EDIT_HELPLINE_MESSAGE,
];
const SUPERVISOR_PERMS = [
  ...LISTENER_PERMS,
  PERMISSIONS.VIEW_HELPLINE_MONITOR,
  PERMISSIONS.EDIT_HELPLINE_TRANSFER,
  PERMISSIONS.EDIT_HELPLINE_WHISPER,
];

const chatRow = (o: Record<string, unknown> = {}) => ({
  id: CHAT_ID,
  tenantId: TENANT.id,
  talkerId: TALKER_ID,
  status: HelplineChatStatus.ACTIVE,
  listenerId: LISTENER,
  previousListenerIds: [],
  transferRequestedAt: null,
  ...o,
});

function build(
  o: {
    chat?: Record<string, unknown>;
    access?: HelplineAccess;
    permissions?: string[];
    requested?: boolean;
    assignable?: boolean;
    takeOver?: { previousListenerId: number | null } | undefined;
    talker?: unknown;
    openChats?: unknown[];
  } = {},
) {
  const chat = chatRow(o.chat);
  const emits: { room: string; event: string; payload: unknown }[] = [];
  const deps = {
    chats: {
      findById: jest.fn().mockResolvedValue(chat),
      requestTransfer: jest.fn().mockResolvedValue(o.requested ?? true),
      assignTarget: jest.fn().mockResolvedValue(o.assignable ?? true),
      takeOver: jest
        .fn()
        .mockResolvedValue(
          'takeOver' in o ? o.takeOver : { previousListenerId: LISTENER },
        ),
      listOpenForTalker: jest.fn().mockResolvedValue(o.openChats ?? [chat]),
    },
    talkers: {
      findOne: jest.fn().mockResolvedValue(
        'talker' in o
          ? o.talker
          : {
              id: TALKER_ID,
              tenantId: TENANT.id,
              blockedAt: null,
              revokedAt: null,
            },
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    listeners: {
      loadChat: jest.fn().mockResolvedValue({
        chat,
        access: o.access ?? HelplineAccess.LISTENER,
        permissions: o.permissions ?? LISTENER_PERMS,
      }),
    },
    views: {
      chatDetail: jest.fn().mockResolvedValue({ chat: { id: CHAT_ID } }),
      staffMessages: jest.fn(async (_c: unknown, rows: { id: number }[]) =>
        rows.map((r) => ({ id: r.id, type: 'WHISPER' })),
      ),
    },
    writer: {
      system: jest.fn().mockResolvedValue({}),
      staffOnly: jest.fn().mockResolvedValue({ id: 77 }),
    },
    events: { record: jest.fn().mockResolvedValue(undefined) },
    notify: {
      chatUpdated: jest.fn().mockResolvedValue(undefined),
      presenceUpdated: jest.fn().mockResolvedValue(undefined),
    },
    queue: { queueChanged: jest.fn() },
    realtime: {
      emit: jest.fn(async (room: string, event: string, payload: unknown) => {
        emits.push({ room, event, payload });
      }),
      joinUser: jest.fn().mockResolvedValue(undefined),
      disconnectRoom: jest.fn().mockResolvedValue(undefined),
    },
    presence: { dropConnection: jest.fn().mockResolvedValue(undefined) },
    profiles: {
      aliases: jest.fn(
        async (_t: string, ids: number[]) =>
          new Map(ids.map((id) => [id, id === SUPERVISOR ? 'Meera' : 'Ravi'])),
      ),
    },
    summaries: { scheduleHandoff: jest.fn() },
    alerts: { notifyAssignee: jest.fn().mockResolvedValue(undefined) },
    directory: {
      usersWithPermission: jest.fn().mockResolvedValue([
        { id: LISTENER, name: 'L' },
        { id: OTHER_LISTENER, name: 'O' },
        { id: SUPERVISOR, name: 'S' },
      ]),
    },
    lifecycle: { endChat: jest.fn().mockResolvedValue({}) },
  };
  const service = new HelplineSupervisionService(
    deps.chats as never,
    deps.talkers as never,
    deps.listeners as never,
    deps.views as never,
    deps.writer as never,
    deps.events as never,
    deps.notify as never,
    deps.queue as never,
    deps.realtime as never,
    deps.presence as never,
    deps.profiles as never,
    deps.summaries as never,
    deps.alerts as never,
    deps.directory as never,
    deps.lifecycle as never,
  );
  return { service, deps, emits, chat };
}

const status = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const r = (
      e as { getResponse?: () => { errorCode?: string } }
    ).getResponse?.();
    return [(e as { getStatus: () => number }).getStatus(), r?.errorCode];
  }
  return 'ok';
};

const listenerUser = { id: LISTENER, tenantId: TENANT.id };
const supervisorUser = { id: SUPERVISOR, tenantId: TENANT.id };

describe('transfer', () => {
  it('the listener of record can request one: talker TRANSFERRING, HANDOFF, lobby + staff + supervisors told', async () => {
    const { service, deps, emits } = build();
    await service.transfer(TENANT, CHAT_ID, listenerUser);
    expect(deps.chats.requestTransfer).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      LISTENER,
      null,
    );
    expect(deps.writer.system).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      HelplineGuestSystemKind.TRANSFERRING,
      expect.any(String),
      { visibleToTalker: true },
    );
    expect(deps.summaries.scheduleHandoff).toHaveBeenCalled();
    expect(emits.map((e) => [e.room, e.event])).toEqual([
      [`staff:${CHAT_ID}`, HelplineServerEvents.TRANSFER_REQUESTED],
      [`lobby:${TENANT.id}`, HelplineServerEvents.TRANSFER_REQUESTED],
      [`supervisors:${TENANT.id}`, HelplineServerEvents.ALERT],
    ]);
    expect((emits[2].payload as { type: string }).type).toBe(
      'TRANSFER_REQUESTED',
    );
    expect(deps.queue.queueChanged).toHaveBeenCalledWith(TENANT.id);
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.TRANSFER_REQUESTED,
      LISTENER,
      { targetListenerId: null },
    );
  });

  it('a supervisor can transfer a chat that is not theirs, aimed at one listener', async () => {
    const { service, deps, emits } = build({
      access: HelplineAccess.READ_ONLY,
      permissions: SUPERVISOR_PERMS,
    });
    await service.transfer(TENANT, CHAT_ID, supervisorUser, OTHER_LISTENER);
    expect(deps.chats.requestTransfer).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      SUPERVISOR,
      OTHER_LISTENER,
    );
    expect(emits[0].payload).toEqual({
      chatId: CHAT_ID,
      toListenerId: OTHER_LISTENER,
    });
    expect(deps.alerts.notifyAssignee).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      OTHER_LISTENER,
      'TRANSFER_REQUESTED',
    );
  });

  it('a previous listener (read-only, no transfer permission) cannot', async () => {
    const { service, deps } = build({
      access: HelplineAccess.READ_ONLY,
      permissions: LISTENER_PERMS,
    });
    expect(
      await status(service.transfer(TENANT, CHAT_ID, listenerUser)),
    ).toEqual([403, ErrorCode.HELPLINE_NOT_LISTENER]);
    expect(deps.chats.requestTransfer).not.toHaveBeenCalled();
  });

  it('only an ACTIVE chat; an ended chat is 409, a waiting chat 400', async () => {
    expect(
      await status(
        build({ chat: { status: HelplineChatStatus.ENDED } }).service.transfer(
          TENANT,
          CHAT_ID,
          listenerUser,
        ),
      ),
    ).toEqual([409, ErrorCode.HELPLINE_CHAT_ENDED]);
    expect(
      (
        await status(
          build({
            chat: { status: HelplineChatStatus.WAITING },
          }).service.transfer(TENANT, CHAT_ID, listenerUser),
        )
      )[0],
    ).toBe(400);
  });

  it('the target must be a listener of this tenant and not the current one', async () => {
    const { service } = build({ permissions: SUPERVISOR_PERMS });
    expect(
      (await status(service.transfer(TENANT, CHAT_ID, supervisorUser, 999)))[0],
    ).toBe(400);
    expect(
      (
        await status(
          service.transfer(TENANT, CHAT_ID, supervisorUser, LISTENER),
        )
      )[0],
    ).toBe(400);
  });

  it('a second request while one is pending is idempotent (no second TRANSFERRING)', async () => {
    const { service, deps } = build({
      chat: { transferRequestedAt: new Date() },
    });
    await service.transfer(TENANT, CHAT_ID, listenerUser);
    expect(deps.chats.requestTransfer).not.toHaveBeenCalled();
    expect(deps.writer.system).not.toHaveBeenCalled();
  });
});

describe('assign', () => {
  it('aims the chat at a listener, records it, alerts them', async () => {
    const { service, deps } = build({
      chat: { status: HelplineChatStatus.WAITING, listenerId: null },
      access: HelplineAccess.READ_ONLY,
      permissions: SUPERVISOR_PERMS,
    });
    await service.assign(TENANT, CHAT_ID, supervisorUser, OTHER_LISTENER);
    expect(deps.chats.assignTarget).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      OTHER_LISTENER,
    );
    expect(deps.writer.staffOnly).toHaveBeenCalledWith(
      expect.anything(),
      HelplineMessageType.SYSTEM,
      'Assigned to Ravi.',
      { params: { listenerName: 'Ravi' } },
      expect.objectContaining({ systemKind: HelplineStaffSystemKind.ASSIGNED }),
    );
    expect(deps.alerts.notifyAssignee).toHaveBeenCalledWith(
      expect.anything(),
      OTHER_LISTENER,
      'ASSIGNED',
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.ASSIGNED,
      SUPERVISOR,
      { listenerId: OTHER_LISTENER },
    );
  });

  it('an ACTIVE chat with no transfer pending cannot be assigned (409)', async () => {
    const { service, deps } = build({
      permissions: SUPERVISOR_PERMS,
      assignable: false,
    });
    expect(
      await status(
        service.assign(TENANT, CHAT_ID, supervisorUser, OTHER_LISTENER),
      ),
    ).toEqual([409, ErrorCode.HELPLINE_ALREADY_CLAIMED]);
    expect(deps.alerts.notifyAssignee).not.toHaveBeenCalled();
  });

  it('the assign UPDATE only matches WAITING (not abandoned) or transfer-pending chats', async () => {
    const repo = { query: jest.fn().mockResolvedValue([[{ id: CHAT_ID }], 1]) };
    await new HelplineChatRepository(repo as never).assignTarget(
      TENANT.id,
      CHAT_ID,
      OTHER_LISTENER,
    );
    const [sql, params] = repo.query.mock.calls[0];
    expect(sql).toContain(`"status" = 'WAITING' AND "abandoned_at" IS NULL`);
    expect(sql).toContain(
      `"status" = 'ACTIVE' AND "transfer_requested_at" IS NOT NULL`,
    );
    expect(sql).toContain('"tenant_id" = $2');
    expect(params).toEqual([CHAT_ID, TENANT.id, OTHER_LISTENER]);
  });
});

describe('take-over', () => {
  it('the supervisor becomes listener of record; rooms, notices, event, audit', async () => {
    const { service, deps } = build({
      access: HelplineAccess.READ_ONLY,
      permissions: SUPERVISOR_PERMS,
    });
    await service.takeOver(TENANT, CHAT_ID, supervisorUser);
    expect(deps.chats.takeOver).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      SUPERVISOR,
    );
    expect(deps.realtime.joinUser).toHaveBeenCalledWith(
      SUPERVISOR,
      `staff:${CHAT_ID}`,
    );
    // Staff-only TAKEN_OVER …
    expect(deps.writer.staffOnly).toHaveBeenCalledWith(
      expect.anything(),
      HelplineMessageType.SYSTEM,
      'Meera took over this chat.',
      { params: { listenerName: 'Meera' } },
      expect.objectContaining({
        systemKind: HelplineStaffSystemKind.TAKEN_OVER,
        senderRole: HelplineSenderRole.SUPERVISOR,
      }),
    );
    // … and the talker only sees ACCEPTED with the new alias.
    expect(deps.writer.system).toHaveBeenCalledWith(
      expect.anything(),
      HelplineGuestSystemKind.ACCEPTED,
      "You're now chatting with Meera.",
      { visibleToTalker: true, params: { listenerName: 'Meera' } },
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.TAKEN_OVER,
      SUPERVISOR,
      { fromListenerId: LISTENER, toListenerId: SUPERVISOR },
    );
    expect(deps.notify.presenceUpdated).toHaveBeenCalledWith(
      TENANT.id,
      LISTENER,
    );
    expect(deps.views.chatDetail).toHaveBeenCalledWith(
      expect.anything(),
      HelplineAccess.LISTENER,
    );
  });

  it('the take-over UPDATE keeps the old listener read-only and clears a pending transfer', async () => {
    const repo = {
      query: jest
        .fn()
        .mockResolvedValue([[{ previousListenerId: LISTENER }], 1]),
    };
    const result = await new HelplineChatRepository(repo as never).takeOver(
      TENANT.id,
      CHAT_ID,
      SUPERVISOR,
    );
    expect(result).toEqual({ previousListenerId: LISTENER });
    const [sql] = repo.query.mock.calls[0];
    expect(sql).toContain(`"previous_listener_ids" || c."listener_id"`);
    expect(sql).toContain('"transfer_requested_at" = NULL');
    expect(sql).toContain(`c."status" = 'ACTIVE'`);
  });

  it('after a take-over the previous listener can no longer send', async () => {
    const service = new HelplineMessageService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.sendListenerText(
        chatRow({ listenerId: SUPERVISOR, takenOverAt: new Date() }) as never,
        LISTENER,
        'hello',
        null,
      ),
    ).rejects.toEqual(new HelplineSendRefused('not_allowed'));
  });

  it('an ended chat is 409; a waiting chat is 400; your own chat is a no-op', async () => {
    expect(
      (
        await status(
          build({
            chat: { status: HelplineChatStatus.ENDED },
          }).service.takeOver(TENANT, CHAT_ID, supervisorUser),
        )
      )[0],
    ).toBe(409);
    expect(
      (
        await status(
          build({
            chat: { status: HelplineChatStatus.WAITING },
          }).service.takeOver(TENANT, CHAT_ID, supervisorUser),
        )
      )[0],
    ).toBe(400);
    const own = build({ chat: { listenerId: SUPERVISOR } });
    await own.service.takeOver(TENANT, CHAT_ID, supervisorUser);
    expect(own.deps.chats.takeOver).not.toHaveBeenCalled();
  });
});

describe('whisper', () => {
  it('persists a staff-only WHISPER and emits WHISPER to the staff room only', async () => {
    const { service, deps, emits } = build({
      access: HelplineAccess.READ_ONLY,
      permissions: SUPERVISOR_PERMS,
    });
    const dto = await service.whisper(
      TENANT,
      CHAT_ID,
      supervisorUser,
      '  ask about sleep  ',
    );
    expect(deps.writer.staffOnly).toHaveBeenCalledWith(
      expect.anything(),
      HelplineMessageType.WHISPER,
      'ask about sleep',
      null,
      {
        senderRole: HelplineSenderRole.SUPERVISOR,
        senderUserId: SUPERVISOR,
        emit: false,
      },
    );
    expect(emits).toEqual([
      {
        room: `staff:${CHAT_ID}`,
        event: HelplineServerEvents.WHISPER,
        payload: { chatId: CHAT_ID, message: dto },
      },
    ]);
  });

  it('a whisper cannot reach a talker room, by any path', async () => {
    // The serialiser never plans a talker emit for a WHISPER row …
    const planned = planMessageEmits(
      {
        id: 1,
        chatId: CHAT_ID,
        type: HelplineMessageType.WHISPER,
        senderRole: HelplineSenderRole.SUPERVISOR,
        visibleToTalker: false,
        systemKind: null,
        content: 'staff only',
        metadata: null,
        createdAt: new Date(),
      } as never,
      'Meera',
    );
    expect(planned.map((p) => p.room)).toEqual([`staff:${CHAT_ID}`]);
    // … the guard refuses the WHISPER event in a talker room …
    expect(
      talkerRoomViolation(
        `talker:${CHAT_ID}`,
        HelplineServerEvents.WHISPER,
        {},
      ),
    ).toMatch(/staff-only/);
    // … and the realtime service drops it before the broker.
    const broker = { publish: jest.fn() };
    await new HelplineRealtimeService(broker as never).emit(
      `talker:${CHAT_ID}`,
      HelplineServerEvents.WHISPER,
      { chatId: CHAT_ID, message: { type: 'WHISPER', content: 'x' } },
    );
    expect(broker.publish).not.toHaveBeenCalled();
  });

  it('an empty whisper is a 400; an ended chat is a 409', async () => {
    const { service } = build({ permissions: SUPERVISOR_PERMS });
    expect(
      (
        await status(service.whisper(TENANT, CHAT_ID, supervisorUser, '   '))
      )[0],
    ).toBe(400);
    const ended = build({ chat: { status: HelplineChatStatus.ENDED } });
    expect(
      (
        await status(
          ended.service.whisper(TENANT, CHAT_ID, supervisorUser, 'x'),
        )
      )[0],
    ).toBe(409);
  });
});

describe('block', () => {
  it('ends the open chat TALKER_BLOCKED, revokes, disconnects, records', async () => {
    const { service, deps } = build();
    await service.block(TENANT, TALKER_ID, supervisorUser, 'abusive messages');
    const [where, patch] = deps.talkers.update.mock.calls[0];
    expect(where).toEqual({ id: TALKER_ID, tenantId: TENANT.id });
    expect(patch.blockedAt).toBeInstanceOf(Date);
    expect(patch.revokedAt).toBeInstanceOf(Date);
    expect(patch.blockedBy).toBe(SUPERVISOR);
    expect(deps.lifecycle.endChat).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      HelplineEndedReason.TALKER_BLOCKED,
      SUPERVISOR,
    );
    expect(deps.realtime.disconnectRoom).toHaveBeenCalledWith(
      `talker:${CHAT_ID}`,
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.TALKER_BLOCKED,
      SUPERVISOR,
    );
  });

  it('a talker of another tenant (or none) is a 404', async () => {
    const { service, deps } = build({ talker: null });
    expect(
      (await status(service.block(TENANT, TALKER_ID, supervisorUser)))[0],
    ).toBe(404);
    expect(deps.talkers.findOne).toHaveBeenCalledWith({
      where: { id: TALKER_ID, tenantId: TENANT.id },
    });
  });

  it('re-blocking keeps the first block time (the 24 h window does not slide)', async () => {
    const first = new Date('2026-10-06T08:00:00Z');
    const { service, deps } = build({
      talker: {
        id: TALKER_ID,
        tenantId: TENANT.id,
        blockedAt: first,
        blockedBy: 3,
        revokedAt: first,
      },
      openChats: [],
    });
    await service.block(TENANT, TALKER_ID, supervisorUser);
    expect(deps.talkers.update.mock.calls[0][1]).toEqual({
      blockedAt: first,
      blockedBy: 3,
      revokedAt: first,
    });
  });
});
