import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  HelplineChatStatus,
  HelplineRiskFlagLevel,
  HelplineRiskLevel,
  HelplineRiskOutcome,
  HelplineRiskSource,
} from '../../constants/helpline.constants';
import { HelplineChatViewService } from '../helpline-chat-view.service';
import {
  CALIBRATION_LIMITS,
  HelplineMonitorService,
  calibrationAggregates,
  lastMessageAgeSeconds,
} from '../helpline-monitor.service';

const TENANT = { id: 't-uuid', code: 'acme', name: 'Acme', logoUrl: null };
const NOW = new Date('2026-10-06T12:00:00Z');
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);

describe('pure helpers', () => {
  it('lastMessageAgeSeconds uses the latest of either side', () => {
    expect(
      lastMessageAgeSeconds(
        { lastTalkerMessageAt: ago(90), lastListenerMessageAt: ago(30) },
        NOW,
      ),
    ).toBe(30);
    expect(
      lastMessageAgeSeconds(
        { lastTalkerMessageAt: null, lastListenerMessageAt: null },
        NOW,
      ),
    ).toBeNull();
  });

  it('calibration aggregates: outcomes, by source, classifier confidence bands', () => {
    const f = (
      source: HelplineRiskSource,
      outcome: HelplineRiskOutcome,
      confidence: number | null,
    ) => ({ source, outcome, confidence });
    const out = calibrationAggregates([
      f(HelplineRiskSource.KEYWORD, HelplineRiskOutcome.CONFIRMED, null),
      f(HelplineRiskSource.KEYWORD, HelplineRiskOutcome.FALSE_POSITIVE, null),
      f(
        HelplineRiskSource.CLASSIFIER,
        HelplineRiskOutcome.FALSE_POSITIVE,
        0.55,
      ),
      f(HelplineRiskSource.CLASSIFIER, HelplineRiskOutcome.CONFIRMED, 0.92),
      f(HelplineRiskSource.CLASSIFIER, HelplineRiskOutcome.UNREVIEWED, 1),
    ]);
    expect(out.counts).toEqual({
      UNREVIEWED: 1,
      CONFIRMED: 2,
      FALSE_POSITIVE: 2,
    });
    expect(out.bySource.KEYWORD).toEqual({
      UNREVIEWED: 0,
      CONFIRMED: 1,
      FALSE_POSITIVE: 1,
      total: 2,
    });
    expect(out.bySource.CLASSIFIER.total).toBe(3);
    const band = (from: number) =>
      out.classifierByConfidence.find((b) => b.from === from);
    expect(band(0.5)).toMatchObject({ FALSE_POSITIVE: 1, to: 0.6 });
    expect(band(0.9)).toMatchObject({ CONFIRMED: 1, UNREVIEWED: 1, to: 1 });
  });
});

function build() {
  const activeChats = [
    {
      id: 'c-quiet',
      tenantId: TENANT.id,
      talkerId: 'tk-1',
      listenerId: 7,
      status: HelplineChatStatus.ACTIVE,
      riskLevel: HelplineRiskLevel.NONE,
      lastTalkerMessageAt: ago(600),
      lastListenerMessageAt: ago(500),
      transferRequestedAt: null,
    },
    {
      id: 'c-risk',
      tenantId: TENANT.id,
      talkerId: 'tk-2',
      listenerId: 8,
      status: HelplineChatStatus.ACTIVE,
      riskLevel: HelplineRiskLevel.HIGH,
      lastTalkerMessageAt: ago(20),
      lastListenerMessageAt: null,
      transferRequestedAt: new Date(),
    },
  ];
  const deps = {
    chats: {
      listActive: jest.fn().mockResolvedValue(activeChats),
      findById: jest.fn(async (_t: string, id: string) => ({
        id,
        tenantId: TENANT.id,
        status: HelplineChatStatus.ENDED,
        riskLevel: HelplineRiskLevel.HIGH,
        listenerId: 7,
        erasedAt: id === 'c-erased' ? new Date() : null,
      })),
    },
    messages: {
      findByIds: jest.fn().mockResolvedValue([
        { id: 11, content: 'I want to end it all', erasedAt: null },
        { id: 12, content: '[erased]', erasedAt: new Date() },
      ]),
    },
    flags: {
      find: jest.fn(
        async (options: {
          where: Record<string, unknown>;
          take?: number;
          select?: string[];
        }) => {
          if (options.select?.includes('level')) {
            return [
              { chatId: 'c-risk', level: HelplineRiskFlagLevel.HIGH },
              { chatId: 'c-risk', level: HelplineRiskFlagLevel.ELEVATED },
              { chatId: 'w-1', level: HelplineRiskFlagLevel.HIGH },
            ];
          }
          if (options.select) {
            return [
              {
                source: HelplineRiskSource.CLASSIFIER,
                outcome: HelplineRiskOutcome.FALSE_POSITIVE,
                confidence: 0.62,
              },
            ];
          }
          return [
            {
              id: 'f-1',
              chatId: 'c-live',
              messageId: 11,
              level: HelplineRiskFlagLevel.HIGH,
              source: HelplineRiskSource.KEYWORD,
              signalStart: 10,
              signalEnd: 20,
              outcome: HelplineRiskOutcome.CONFIRMED,
              outcomeNote: null,
              acknowledgedBy: null,
              createdAt: NOW,
              resourcesSent: true,
              supervisorsAlerted: 2,
            },
            {
              id: 'f-2',
              chatId: 'c-erased',
              messageId: 12,
              level: HelplineRiskFlagLevel.ELEVATED,
              source: HelplineRiskSource.CLASSIFIER,
              signalStart: 0,
              signalEnd: 5,
              outcome: HelplineRiskOutcome.UNREVIEWED,
              outcomeNote: null,
              acknowledgedBy: null,
              createdAt: NOW,
              resourcesSent: false,
              supervisorsAlerted: null,
            },
          ];
        },
      ),
    },
    queue: {
      buildQueue: jest.fn().mockResolvedValue({
        waiting: [
          { chatId: 'w-1', kind: 'NEW' },
          { chatId: 'c-risk', kind: 'TRANSFER' },
        ],
        counts: { waiting: 1, active: 2, listenersAvailable: 1 },
      }),
    },
    presence: {
      listPresence: jest
        .fn()
        .mockResolvedValue([{ userId: 7, presence: 'AVAILABLE' }]),
      connectedMany: jest.fn(
        async (kind: string, ids: (string | number)[]) =>
          new Map(
            ids.map((id) => [id, kind === 'talker' ? id === 'tk-2' : id === 7]),
          ),
      ),
    },
    profiles: {
      getProfiles: jest.fn(
        async (_t: string, users: { id: number }[]) =>
          new Map(
            users.map((u) => [
              u.id,
              {
                displayName: `L${u.id}`,
                maxConcurrentChats: 2,
                languages: ['en'],
                notificationsEnabled: true,
              },
            ]),
          ),
      ),
      aliases: jest.fn().mockResolvedValue(new Map([[7, 'Ravi']])),
    },
    directory: {
      usersWithPermission: jest.fn().mockResolvedValue([
        { id: 7, name: 'Ravi K' },
        { id: 8, name: 'Asha P' },
      ]),
    },
    settings: {
      getSettings: jest.fn().mockResolvedValue(HELPLINE_DEFAULT_SETTINGS),
    },
  };
  // Real riskFlagDto (signal derivation), stubbed list items and notes.
  const views = Object.assign(
    Object.create(HelplineChatViewService.prototype),
    {
      chatListItems: jest.fn(
        async (_t: string, chats: { id: string; riskLevel: string }[]) =>
          chats.map((c) => ({ id: c.id, riskLevel: c.riskLevel })),
      ),
      decryptNotes: jest.fn(async (flags: unknown[]) => flags),
    },
  );
  const service = new HelplineMonitorService(
    deps.chats as never,
    deps.messages as never,
    deps.flags as never,
    deps.queue as never,
    views as never,
    deps.presence as never,
    deps.profiles as never,
    deps.directory as never,
    deps.settings as never,
  );
  return { service, deps };
}

describe('GET /monitor', () => {
  it('tiles, active chats (risk first) with liveness and open flags, roster', async () => {
    const { service } = build();
    const dto = await service.monitor(TENANT, NOW);
    expect(dto.tiles).toEqual({
      waiting: 1,
      active: 2,
      listenersAvailable: 1,
      openHighFlags: 2,
    });
    expect(dto.activeChats.map((c) => c.id)).toEqual(['c-risk', 'c-quiet']);
    expect(dto.activeChats[0]).toMatchObject({
      talkerConnected: true,
      listenerConnected: false,
      transferPending: true,
      openFlags: 2,
      lastMessageAgeSeconds: 20,
    });
    expect(dto.activeChats[1]).toMatchObject({
      listenerConnected: true,
      openFlags: 0,
      lastMessageAgeSeconds: 500,
    });
    expect(dto.listeners).toEqual([
      {
        userId: 7,
        displayName: 'L7',
        presence: 'AVAILABLE',
        activeChatCount: 1,
        maxConcurrentChats: 2,
        languages: ['en'],
      },
      {
        userId: 8,
        displayName: 'L8',
        presence: 'OFFLINE',
        activeChatCount: 1,
        maxConcurrentChats: 2,
        languages: ['en'],
      },
    ]);
  });

  it('every read is tenant-scoped', async () => {
    const { service, deps } = build();
    await service.monitor(TENANT, NOW);
    expect(deps.chats.listActive).toHaveBeenCalledWith(TENANT.id);
    expect(deps.queue.buildQueue).toHaveBeenCalledWith(TENANT.id);
    expect(deps.presence.listPresence).toHaveBeenCalledWith(TENANT.id);
    expect(deps.directory.usersWithPermission).toHaveBeenCalledWith(
      TENANT,
      PERMISSIONS.VIEW_HELPLINE_LOBBY,
    );
    for (const [options] of deps.flags.find.mock.calls) {
      expect(options.where.tenantId).toBe(TENANT.id);
    }
  });
});

describe('GET /risk-flags (calibration)', () => {
  it('items carry the live signal (null once erased), chat context and alert reach', async () => {
    const { service } = build();
    const dto = await service.calibration(
      TENANT,
      { id: 9, tenantId: TENANT.id },
      {},
      NOW,
    );
    expect(dto.items[0]).toMatchObject({
      id: 'f-1',
      chatId: 'c-live',
      signal: 'end it all',
      supervisorsAlerted: 2,
      listener: { id: 7, displayName: 'Ravi' },
      erased: false,
    });
    expect(dto.items[1]).toMatchObject({ signal: null, erased: true });
    expect(dto.riskHighConfidence).toBe(0.7);
    expect(dto.days).toBe(CALIBRATION_LIMITS.DEFAULT_DAYS);
    expect(dto.counts.FALSE_POSITIVE).toBe(1);
  });

  it('outcome narrows the items only; days is clamped; all tenant-scoped', async () => {
    const { service, deps } = build();
    const dto = await service.calibration(
      TENANT,
      { id: 9, tenantId: TENANT.id },
      { outcome: 'CONFIRMED', days: 500 },
      NOW,
    );
    expect(dto.days).toBe(CALIBRATION_LIMITS.MAX_DAYS);
    const [windowCall, itemsCall] = deps.flags.find.mock.calls;
    expect(windowCall[0].where).not.toHaveProperty('outcome');
    expect(itemsCall[0].where).toMatchObject({
      tenantId: TENANT.id,
      outcome: 'CONFIRMED',
    });
    expect(itemsCall[0].take).toBe(CALIBRATION_LIMITS.MAX_ITEMS);
    expect(deps.messages.findByIds).toHaveBeenCalledWith(TENANT.id, [11, 12]);
    for (const [tenantId] of deps.chats.findById.mock.calls) {
      expect(tenantId).toBe(TENANT.id);
    }
  });

  it('an unknown outcome is ignored rather than matching nothing', async () => {
    const { service, deps } = build();
    await service.calibration(
      TENANT,
      { id: 9, tenantId: TENANT.id },
      { outcome: 'NOPE' },
      NOW,
    );
    expect(deps.flags.find.mock.calls[1][0].where).not.toHaveProperty(
      'outcome',
    );
  });
});
