jest.mock('axios', () => ({ __esModule: true, default: { post: jest.fn() } }));

import axios from 'axios';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PLATFORM_TIER_ROLES } from 'src/common/constants/user.constants';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  HelplineAccess,
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineGuestSystemKind,
  HelplineMessageType,
  HelplineRiskFlagLevel,
  HelplineRiskSource,
  HelplineServerEvents,
  HelplineStaffSystemKind,
} from '../../constants/helpline.constants';
import {
  HELPLINE_ALERT_WINDOWS,
  HelplineAlertService,
  alertCopy,
} from '../helpline-alert.service';
import { HelplineListenerService } from '../helpline-listener.service';
import {
  HelplineRiskService,
  emergencyResourcesText,
  foldDecision,
} from '../helpline-risk.service';
import { HelplineStaffDirectoryService } from '../helpline-staff-directory.service';
import { testCipher } from './helpline-test-cipher';

const CHAT_ID = '11111111-1111-4111-8111-111111111111';
const TENANT = {
  id: 't-uuid',
  code: 'acme',
  name: 'Acme Care',
  logoUrl: null,
};
const TALKER_TEXT = 'I have been giving my things away to my sister';
const TALKER_NAME = 'Asha';

const settings = (o: Record<string, unknown> = {}) => ({
  ...structuredClone(HELPLINE_DEFAULT_SETTINGS),
  ...o,
});

describe('emergencyResourcesText', () => {
  it("talker's language, then the org's English, then the platform default", () => {
    const s = settings({ emergencyResources: { en: 'Org EN', hi: 'Org HI' } });
    expect(emergencyResourcesText(s, 'hi')).toBe('Org HI');
    expect(emergencyResourcesText(s, 'ta')).toBe('Org EN');
    expect(
      emergencyResourcesText(settings({ emergencyResources: {} }), 'ta'),
    ).toBe(HELPLINE_DEFAULT_SETTINGS.emergencyResources.en);
    expect(
      emergencyResourcesText(
        settings({ emergencyResources: { hi: '  ' } }),
        'hi',
      ),
    ).toBe(HELPLINE_DEFAULT_SETTINGS.emergencyResources.en);
  });
});

// ── Alert service ────────────────────────────────────────────────────────────

function buildAlerts(
  o: {
    claimed?: boolean;
    stored?: string | null;
    recipients?: { id: number; name: string }[];
    settings?: ReturnType<typeof settings>;
    directoryError?: Error;
  } = {},
) {
  const emits: {
    room: string;
    event: string;
    payload: Record<string, unknown>;
  }[] = [];
  const deps = {
    tenants: { resolve: jest.fn().mockResolvedValue(TENANT) },
    settings: {
      getSettings: jest.fn().mockResolvedValue(o.settings ?? settings()),
    },
    directory: {
      usersWithPermission: o.directoryError
        ? jest.fn().mockRejectedValue(o.directoryError)
        : jest.fn().mockResolvedValue(
            o.recipients ?? [
              { id: 7, name: 'Listener' },
              { id: 9, name: 'Supervisor' },
              { id: 11, name: 'Admin' },
            ],
          ),
    },
    profiles: {
      aliases: jest.fn().mockResolvedValue(new Map([[7, 'Priya']])),
    },
    presence: {
      claimWindow: jest.fn().mockResolvedValue(o.claimed ?? true),
      windowValue: jest.fn().mockResolvedValue(o.stored ?? null),
      setWindowValue: jest.fn().mockResolvedValue(undefined),
    },
    realtime: {
      emit: jest.fn(
        async (
          room: string,
          event: string,
          payload: Record<string, unknown>,
        ) => {
          emits.push({ room, event, payload });
        },
      ),
    },
    events: { record: jest.fn().mockResolvedValue(undefined) },
    inApp: { create: jest.fn().mockResolvedValue({}) },
    deviceTokens: { getTokensForUser: jest.fn().mockResolvedValue(['tok']) },
    push: { sendDataMessage: jest.fn().mockResolvedValue(undefined) },
  };
  const service = new HelplineAlertService(
    deps.tenants as never,
    deps.settings as never,
    deps.directory as never,
    deps.profiles as never,
    deps.presence as never,
    deps.realtime as never,
    deps.events as never,
    deps.inApp as never,
    deps.deviceTokens as never,
    deps.push as never,
  );
  return { service, deps, emits };
}

const activeChat = {
  id: CHAT_ID,
  tenantId: TENANT.id,
  listenerId: 7,
  status: HelplineChatStatus.ACTIVE,
};

describe('HelplineAlertService', () => {
  beforeEach(() => (axios.post as jest.Mock).mockReset().mockResolvedValue({}));

  it('HIGH risk: socket ALERT, one in-app notification per supervisor (not the listener), event, count', async () => {
    const { service, deps, emits } = buildAlerts();
    const result = await service.riskHigh(
      activeChat,
      HelplineRiskSource.CLASSIFIER,
      true,
    );
    expect(result).toEqual({ recipients: 2, deduped: false });
    expect(deps.presence.claimWindow).toHaveBeenCalledWith(
      `risk:${CHAT_ID}`,
      HELPLINE_ALERT_WINDOWS.RISK_SECONDS,
      '0',
    );
    expect(deps.presence.setWindowValue).toHaveBeenCalledWith(
      `risk:${CHAT_ID}`,
      '2',
    );
    expect(emits).toEqual([
      {
        room: `supervisors:${TENANT.id}`,
        event: HelplineServerEvents.ALERT,
        payload: {
          type: 'RISK_HIGH',
          chatId: CHAT_ID,
          level: 'HIGH',
          at: expect.any(String),
        },
      },
    ]);
    expect(deps.inApp.create.mock.calls.map(([n]) => n.userId)).toEqual([
      9, 11,
    ]);
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.SUPERVISOR_ALERTED,
      null,
      expect.objectContaining({ type: 'RISK_HIGH', recipients: 2 }),
    );
  });

  it('recipients come from the tenant-scoped monitor permission', async () => {
    const { service, deps } = buildAlerts();
    await service.riskHigh(activeChat, HelplineRiskSource.KEYWORD, false);
    expect(deps.directory.usersWithPermission).toHaveBeenCalledWith(
      TENANT,
      PERMISSIONS.VIEW_HELPLINE_MONITOR,
    );
  });

  it('notification payloads carry no message text and no talker name', async () => {
    const { service, deps } = buildAlerts();
    await service.riskHigh(activeChat, HelplineRiskSource.CLASSIFIER, true);
    for (const [notification] of deps.inApp.create.mock.calls) {
      const serialised = JSON.stringify(notification);
      expect(serialised).not.toContain(TALKER_TEXT);
      expect(serialised).not.toContain('giving my things');
      expect(serialised).not.toContain(TALKER_NAME);
      expect(notification.type).toBe('HELPLINE_RISK_HIGH');
      expect(Object.keys(notification.data).sort()).toEqual(
        ['alert', 'chatId', 'level', 'screen', 'source'].sort(),
      );
      expect(notification.title).toBe(
        'High-risk flag in a helpline chat — open the monitor',
      );
    }
  });

  it('deduped within the window: nothing is sent again; the earlier reach is reported', async () => {
    const { service, deps, emits } = buildAlerts({
      claimed: false,
      stored: '3',
    });
    const result = await service.riskHigh(
      activeChat,
      HelplineRiskSource.KEYWORD,
      true,
    );
    expect(result).toEqual({ recipients: 3, deduped: true });
    expect(emits).toEqual([]);
    expect(deps.inApp.create).not.toHaveBeenCalled();
    expect(deps.events.record).not.toHaveBeenCalled();
  });

  it('a WAITING chat alerts as HIGH_RISK_WAITING', async () => {
    const { service, emits } = buildAlerts();
    await service.riskHigh(
      { ...activeChat, listenerId: null, status: HelplineChatStatus.WAITING },
      HelplineRiskSource.KEYWORD,
      true,
    );
    expect(emits[0].payload.type).toBe('HIGH_RISK_WAITING');
  });

  it('in-app off: the socket still alerts; no rows are written', async () => {
    const { service, deps, emits } = buildAlerts({
      settings: settings({
        supervisorAlertChannels: {
          inApp: false,
          push: false,
          slackWebhookUrl: null,
        },
      }),
    });
    const result = await service.riskHigh(
      activeChat,
      HelplineRiskSource.KEYWORD,
      false,
    );
    expect(result.recipients).toBe(2);
    expect(emits).toHaveLength(1);
    expect(deps.inApp.create).not.toHaveBeenCalled();
  });

  it('push and Slack per org settings; Slack only to hooks.slack.com, 3 s, no content', async () => {
    const { service, deps } = buildAlerts({
      settings: settings({
        supervisorAlertChannels: {
          inApp: true,
          push: true,
          slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x',
        },
      }),
    });
    await service.riskHigh(activeChat, HelplineRiskSource.CLASSIFIER, true);
    await new Promise((r) => setImmediate(r));
    expect(deps.push.sendDataMessage).toHaveBeenCalledWith(
      ['tok', 'tok'],
      expect.objectContaining({
        type: 'HELPLINE_RISK_HIGH',
        screen: 'HelplineMonitor',
      }),
    );
    const [url, body, options] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T/B/x');
    expect(options).toEqual({ timeout: 3_000 });
    expect(body.text).toContain('Acme Care');
    expect(body.text).toContain('HIGH');
    expect(body.text).toContain('/helpline/monitor');
    expect(body.text).not.toContain('Priya');

    (axios.post as jest.Mock).mockClear();
    const other = buildAlerts({
      settings: settings({
        supervisorAlertChannels: {
          inApp: false,
          push: false,
          slackWebhookUrl: 'https://evil.example.com/hook',
        },
      }),
    });
    await other.service.riskHigh(activeChat, HelplineRiskSource.KEYWORD, false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('a failure reaches nobody and never throws', async () => {
    const { service } = buildAlerts({ directoryError: new Error('db down') });
    await expect(
      service.riskHigh(activeChat, HelplineRiskSource.KEYWORD, false),
    ).resolves.toEqual({ recipients: 0, deduped: false });
  });

  it('listener asks for help: 2-minute window, the requester is never notified', async () => {
    const { service, deps, emits } = buildAlerts();
    const result = await service.listenerRequestedHelp(activeChat, 7);
    expect(deps.presence.claimWindow).toHaveBeenCalledWith(
      `help:${CHAT_ID}`,
      HELPLINE_ALERT_WINDOWS.HELP_SECONDS,
      '0',
    );
    expect(result.recipients).toBe(2);
    expect(emits[0].payload).toEqual({
      type: 'LISTENER_REQUESTED_HELP',
      chatId: CHAT_ID,
      at: expect.any(String),
    });
    expect(deps.inApp.create.mock.calls[0][0].type).toBe(
      'HELPLINE_LISTENER_REQUESTED_HELP',
    );
    expect(deps.events.record.mock.calls[0][4]).toMatchObject({
      requestedBy: 7,
    });
  });

  it('listener-disconnected alerts go through the same service', async () => {
    const { service, deps, emits } = buildAlerts();
    await service.listenerDisconnected(activeChat);
    expect(emits[0].payload.type).toBe('LISTENER_DISCONNECTED');
    expect(deps.inApp.create.mock.calls[0][0].type).toBe(
      'HELPLINE_LISTENER_DISCONNECTED',
    );
  });

  it('copy is built only from org, listener alias and source', () => {
    const copy = alertCopy({
      type: 'RISK_HIGH',
      orgName: 'Acme Care',
      listenerName: 'Priya',
      source: HelplineRiskSource.CLASSIFIER,
      resourcesSent: true,
    });
    expect(copy.body).toBe(
      "Priya's chat was flagged high risk by the AI risk check. Emergency resources were sent to the talker. Open the monitor to support the listener.",
    );
  });
});

describe('HelplineStaffDirectoryService', () => {
  it('matches the tenant by uuid OR code, by permission, excluding platform staff; cached', async () => {
    const dataSource = {
      query: jest.fn().mockResolvedValue([{ id: '9', name: 'S' }]),
    };
    const directory = new HelplineStaffDirectoryService(dataSource as never);
    const out = await directory.usersWithPermission(
      TENANT,
      PERMISSIONS.VIEW_HELPLINE_MONITOR,
    );
    expect(out).toEqual([{ id: 9, name: 'S' }]);
    const [sql, params] = dataSource.query.mock.calls[0];
    expect(sql).toContain('u.tenant_id IN ($1, $2)');
    expect(sql).toContain('p.name = $3');
    expect(params).toEqual([
      TENANT.id,
      TENANT.code,
      PERMISSIONS.VIEW_HELPLINE_MONITOR,
      PLATFORM_TIER_ROLES,
    ]);
    await directory.usersWithPermission(
      TENANT,
      PERMISSIONS.VIEW_HELPLINE_MONITOR,
    );
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });
});

// ── Risk service: the HIGH protocol ──────────────────────────────────────────

type StoredFlag = Record<string, unknown> & {
  id: string;
  acknowledgedAt: Date | null;
};

/**
 * The risk service over in-memory flag and marker stores, so folding is
 * exercised through the real raiseFlag / recordHit code (transaction and
 * advisory lock included).
 */
function buildRisk(
  o: {
    resourcesClaimed?: boolean[];
    alertRecipients?: number;
    status?: HelplineChatStatus;
  } = {},
) {
  const claims = [...(o.resourcesClaimed ?? [true])];
  const emits: {
    room: string;
    event: string;
    payload: Record<string, unknown>;
  }[] = [];
  const store: StoredFlag[] = [];
  const markers: {
    parentMessageId: number;
    metadata: Record<string, unknown>;
  }[] = [];
  const locks: string[] = [];
  let nextFlag = 1;
  const flagRepo = {
    create: (x: Record<string, unknown>) => ({ ...x }),
    findOne: jest.fn(async () => {
      const open = store.filter((f) => f.acknowledgedAt == null);
      return open.length ? { ...open[open.length - 1] } : null;
    }),
    save: jest.fn(async (f: Record<string, unknown>) => {
      const row = {
        resourcesSent: false,
        supervisorsAlerted: null,
        acknowledgedAt: null,
        createdAt: new Date(),
        ...f,
        id: (f.id as string) ?? `flag-${nextFlag++}`,
      } as StoredFlag;
      const i = store.findIndex((x) => x.id === row.id);
      if (i >= 0) store[i] = row;
      else store.push(row);
      return { ...row };
    }),
  };
  const deps = {
    flags: {
      manager: {
        transaction: async (fn: (em: unknown) => Promise<unknown>) =>
          fn({
            query: async (_sql: string, params: string[]) => {
              locks.push(params[0]);
            },
            getRepository: () => flagRepo,
          }),
      },
      update: jest.fn(
        async (where: { id: string }, patch: Record<string, unknown>) => {
          const row = store.find((f) => f.id === where.id);
          if (row) Object.assign(row, patch);
          return {};
        },
      ),
    },
    chats: {
      raiseRisk: jest
        .fn()
        .mockResolvedValue({ riskLevel: 'HIGH', priority: 100 }),
      markResourcesSent: jest.fn(async () => claims.shift() ?? false),
    },
    writer: {
      staffOnly: jest.fn(
        async (
          _chat: unknown,
          _type: string,
          _content: string,
          metadata: Record<string, unknown>,
          options: { parentMessageId: number },
        ) => {
          markers.push({ parentMessageId: options.parentMessageId, metadata });
          return {};
        },
      ),
      system: jest.fn().mockResolvedValue({}),
    },
    views: {
      riskFlagDto: jest.fn((flag: Record<string, unknown>) => ({
        id: flag.id,
        level: flag.level,
        resourcesSent: flag.resourcesSent,
        supervisorsAlerted: flag.supervisorsAlerted ?? null,
        hitCount: flag.hitCount,
        signal: null,
      })),
    },
    events: { record: jest.fn().mockResolvedValue(undefined) },
    queue: { queueChanged: jest.fn() },
    realtime: {
      emit: jest.fn(
        async (
          room: string,
          event: string,
          payload: Record<string, unknown>,
        ) => {
          emits.push({ room, event, payload });
        },
      ),
    },
    alerts: {
      riskHigh: jest.fn().mockResolvedValue({
        recipients: o.alertRecipients ?? 2,
        deduped: false,
      }),
    },
    settings: {
      getSettings: jest.fn().mockResolvedValue(settings()),
      defaults: settings(),
    },
    tenants: { resolve: jest.fn().mockResolvedValue(TENANT) },
    notify: { chatUpdated: jest.fn().mockResolvedValue(undefined) },
    messages: {
      findById: jest.fn(async (_t: string, _c: string, id: number) => ({
        id,
        content: TALKER_TEXT,
        erasedAt: null,
      })),
      listRiskMarkers: jest.fn(
        async (_t: string, _c: string, parentMessageId: number) =>
          markers.filter((m) => m.parentMessageId === parentMessageId),
      ),
    },
  };
  const service = new HelplineRiskService(
    deps.flags as never,
    deps.chats as never,
    {} as never,
    deps.writer as never,
    deps.views as never,
    deps.events as never,
    deps.queue as never,
    deps.realtime as never,
    testCipher(),
    deps.alerts as never,
    deps.settings as never,
    deps.tenants as never,
    deps.notify as never,
    deps.messages as never,
  );
  const chat = {
    id: CHAT_ID,
    tenantId: TENANT.id,
    status: o.status ?? HelplineChatStatus.ACTIVE,
    language: 'hi',
    listenerId: 7,
    resourcesSentAt: null,
  };
  const raise = (
    level: HelplineRiskFlagLevel,
    r: {
      messageId?: number;
      source?: HelplineRiskSource;
      confidence?: number | null;
      subject?: string | null;
      signal?: [number, number] | null;
    } = {},
  ) =>
    service.raiseFlag(
      chat as never,
      { id: r.messageId ?? 5, content: TALKER_TEXT } as never,
      {
        level,
        source: r.source ?? HelplineRiskSource.CLASSIFIER,
        confidence: r.confidence === undefined ? 0.9 : r.confidence,
        subject: (r.subject ?? null) as never,
        ruleId: null,
        signalStart: r.signal ? r.signal[0] : null,
        signalEnd: r.signal ? r.signal[1] : null,
      },
    );
  const ack = (id: string) => {
    const row = store.find((f) => f.id === id);
    if (row) row.acknowledgedAt = new Date();
  };
  return { service, deps, emits, chat, raise, store, markers, locks, ack };
}

describe('HelplineRiskService HIGH protocol', () => {
  it('sends the org resources in the talker language as a talker-visible SYSTEM RESOURCES, then alerts', async () => {
    const { deps, raise } = buildRisk();
    await raise(HelplineRiskFlagLevel.HIGH);
    expect(deps.writer.system).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      HelplineGuestSystemKind.RESOURCES,
      HELPLINE_DEFAULT_SETTINGS.emergencyResources.hi,
      { visibleToTalker: true },
    );
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      HelplineChatEventType.RESOURCES_SENT,
      null,
      expect.objectContaining({ flagId: 'flag-1' }),
    );
    expect(deps.alerts.riskHigh).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      HelplineRiskSource.CLASSIFIER,
      true,
    );
    expect(deps.flags.update).toHaveBeenCalledWith(
      { id: 'flag-1', tenantId: TENANT.id },
      { supervisorsAlerted: 2, resourcesSent: true },
    );
  });

  it('RISK_FLAGGED carries resourcesSent and supervisorsAlerted', async () => {
    const { emits, raise } = buildRisk({ alertRecipients: 3 });
    await raise(HelplineRiskFlagLevel.HIGH);
    const flagged = emits.find(
      (e) => e.event === HelplineServerEvents.RISK_FLAGGED,
    );
    expect(flagged?.payload.flag).toMatchObject({
      resourcesSent: true,
      supervisorsAlerted: 3,
    });
  });

  it('0 when nobody could be alerted', async () => {
    const { emits, raise } = buildRisk({ alertRecipients: 0 });
    await raise(HelplineRiskFlagLevel.HIGH);
    const flagged = emits.find(
      (e) => e.event === HelplineServerEvents.RISK_FLAGGED,
    );
    expect(flagged?.payload.flag).toMatchObject({ supervisorsAlerted: 0 });
  });

  it('resources go once per chat — even a fresh HIGH flag after an ack sends none', async () => {
    const { deps, raise, ack } = buildRisk({ resourcesClaimed: [true, false] });
    const first = await raise(HelplineRiskFlagLevel.HIGH, { messageId: 5 });
    ack(first.id as string);
    await raise(HelplineRiskFlagLevel.HIGH, { messageId: 6 });
    expect(deps.writer.system).toHaveBeenCalledTimes(1);
    expect(deps.chats.markResourcesSent).toHaveBeenCalledTimes(2);
  });

  it('a WAITING talker gets the resources too', async () => {
    const { deps, raise } = buildRisk({ status: HelplineChatStatus.WAITING });
    await raise(HelplineRiskFlagLevel.HIGH);
    expect(deps.writer.system).toHaveBeenCalledTimes(1);
  });

  it('ELEVATED: no resources, no alert, supervisorsAlerted null', async () => {
    const { deps, emits, raise } = buildRisk();
    await raise(HelplineRiskFlagLevel.ELEVATED);
    expect(deps.writer.system).not.toHaveBeenCalled();
    expect(deps.alerts.riskHigh).not.toHaveBeenCalled();
    const flagged = emits.find(
      (e) => e.event === HelplineServerEvents.RISK_FLAGGED,
    );
    expect(flagged?.payload.flag).toMatchObject({ supervisorsAlerted: null });
  });

  it('an alert failure still records 0 and never throws', async () => {
    const { deps, raise } = buildRisk();
    deps.alerts.riskHigh.mockRejectedValue(new Error('boom'));
    await expect(raise(HelplineRiskFlagLevel.HIGH)).resolves.toBeDefined();
    expect(deps.flags.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supervisorsAlerted: 0 }),
    );
  });
});

// ── Fold until acknowledged ──────────────────────────────────────────────────

describe('repeated hits fold into the open flag until it is acknowledged', () => {
  const HIGH = HelplineRiskFlagLevel.HIGH;
  const ELEVATED = HelplineRiskFlagLevel.ELEVATED;
  type Emit = { event: string; payload: Record<string, unknown> };
  const flaggedEvents = (emits: Emit[]) =>
    emits.filter((e) => e.event === HelplineServerEvents.RISK_FLAGGED);
  const updatedEvents = (emits: Emit[]) =>
    emits.filter((e) => e.event === HelplineServerEvents.RISK_FLAG_UPDATED);

  it('foldDecision: higher upgrades, same-or-lower folds, same message never counts twice', () => {
    expect(foldDecision({ level: ELEVATED }, HIGH, false)).toBe('UPGRADED');
    expect(foldDecision({ level: HIGH }, HIGH, false)).toBe('FOLDED');
    expect(foldDecision({ level: HIGH }, ELEVATED, false)).toBe('FOLDED');
    expect(foldDecision({ level: ELEVATED }, HIGH, true)).toBe(
      'SAME_MESSAGE_UPGRADE',
    );
    expect(foldDecision({ level: HIGH }, HIGH, true)).toBe('IGNORED');
    expect(foldDecision({ level: ELEVATED }, ELEVATED, true)).toBe('IGNORED');
  });

  it('while unacknowledged, a new hit folds: one flag, hit_count + latest updated, RISK_FLAG_UPDATED, no re-alert', async () => {
    const { deps, emits, raise, store, markers, locks } = buildRisk();
    const first = await raise(HIGH, {
      messageId: 5,
      confidence: 0.75,
      subject: 'SELF',
      signal: [0, 6],
    });
    const second = await raise(HIGH, {
      messageId: 6,
      source: HelplineRiskSource.KEYWORD,
      confidence: null,
      signal: [10, 20],
    });
    const third = await raise(ELEVATED, {
      messageId: 7,
      confidence: 0.95,
      subject: 'OTHER',
      signal: [2, 4],
    });
    expect(store).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(store[0]).toMatchObject({
      level: HIGH,
      hitCount: 3,
      messageId: 5,
      latestMessageId: 7,
      latestSignalStart: 2,
      latestSignalEnd: 4,
      confidence: 0.95, // the max
      subject: 'OTHER', // the latest
      source: HelplineRiskSource.CLASSIFIER, // the opener's
    });
    expect(store[0].lastHitAt).toBeInstanceOf(Date);
    expect(flaggedEvents(emits)).toHaveLength(1);
    expect(updatedEvents(emits)).toHaveLength(2);
    expect(updatedEvents(emits)[1].payload).toMatchObject({
      flag: { id: first.id, hitCount: 3 },
    });
    // The HIGH side effects ran once, for the opener only.
    expect(deps.alerts.riskHigh).toHaveBeenCalledTimes(1);
    expect(deps.chats.markResourcesSent).toHaveBeenCalledTimes(1);
    // A RISK marker per hit, pointing at the folded flag.
    expect(markers.map((m) => [m.parentMessageId, m.metadata.folded])).toEqual([
      [5, false],
      [6, true],
      [7, true],
    ]);
    expect(markers.every((m) => m.metadata.flagId === first.id)).toBe(true);
    // Every hit took the per-chat lock.
    expect(locks).toEqual(Array(3).fill(`helpline-risk:${CHAT_ID}`));
  });

  it('an ELEVATED flag upgraded to HIGH by a later message runs onHighRisk once', async () => {
    const { deps, emits, raise, store } = buildRisk();
    await raise(ELEVATED, { messageId: 5 });
    expect(deps.alerts.riskHigh).not.toHaveBeenCalled();
    await raise(HIGH, { messageId: 6 });
    await raise(HIGH, { messageId: 7 });
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ level: HIGH, hitCount: 3 });
    expect(deps.alerts.riskHigh).toHaveBeenCalledTimes(1);
    expect(deps.writer.system).toHaveBeenCalledTimes(1); // resources
    expect(store[0].supervisorsAlerted).toBe(2);
    expect(updatedEvents(emits)[0].payload).toMatchObject({
      flag: { level: HIGH, supervisorsAlerted: 2, resourcesSent: true },
    });
    expect(deps.events.record).toHaveBeenCalledWith(
      TENANT.id,
      CHAT_ID,
      'RISK_FLAGGED',
      null,
      expect.objectContaining({ level: HIGH, upgraded: true }),
    );
  });

  it('after an acknowledgement the next hit opens a FRESH flag and re-escalates', async () => {
    const { deps, emits, raise, store, ack } = buildRisk({
      resourcesClaimed: [true, false],
    });
    const first = await raise(HIGH, { messageId: 5 });
    ack(first.id as string);
    const fresh = await raise(HIGH, { messageId: 6 });
    expect(fresh.id).not.toBe(first.id);
    expect(store).toHaveLength(2);
    expect(flaggedEvents(emits)).toHaveLength(2);
    // Through onHighRisk again (the alert service applies its own 10-min dedupe).
    expect(deps.alerts.riskHigh).toHaveBeenCalledTimes(2);
  });

  it('keyword + classifier on the SAME message is still one hit (the classifier may upgrade it)', async () => {
    const { deps, emits, raise, store, markers } = buildRisk();
    await raise(ELEVATED, {
      messageId: 5,
      source: HelplineRiskSource.KEYWORD,
      confidence: null,
    });
    await raise(HIGH, { messageId: 5, confidence: 0.9, subject: 'SELF' });
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      level: HIGH,
      hitCount: 1,
      confidence: 0.9,
      subject: 'SELF',
    });
    expect(markers).toHaveLength(1);
    expect(deps.alerts.riskHigh).toHaveBeenCalledTimes(1);
    expect(updatedEvents(emits)).toHaveLength(1);
    // A same-or-lower second hit on that message records nothing at all.
    emits.length = 0;
    await raise(HIGH, { messageId: 5, source: HelplineRiskSource.KEYWORD });
    expect(store[0].hitCount).toBe(1);
    expect(markers).toHaveLength(1);
    expect(emits).toEqual([]);
  });
});

// ── "Alert supervisor" ───────────────────────────────────────────────────────

describe('POST chats/:id/alert-supervisor', () => {
  const build = (
    o: {
      access?: 'LISTENER' | 'MONITOR';
      status?: HelplineChatStatus;
      recipients?: number;
    } = {},
  ) => {
    const chat = {
      id: CHAT_ID,
      tenantId: TENANT.id,
      listenerId: o.access === 'MONITOR' ? 7 : 9,
      previousListenerIds: [],
      status: o.status ?? HelplineChatStatus.ACTIVE,
    };
    const writer = { staffOnly: jest.fn().mockResolvedValue({}) };
    const alerts = {
      listenerRequestedHelp: jest
        .fn()
        .mockResolvedValue({ recipients: o.recipients ?? 2, deduped: false }),
    };
    const args: unknown[] = Array(15).fill({});
    args[0] = { findById: jest.fn().mockResolvedValue(chat) };
    args[2] = {
      getUserPermissions: jest
        .fn()
        .mockResolvedValue([
          PERMISSIONS.VIEW_HELPLINE_COPILOT,
          PERMISSIONS.VIEW_HELPLINE_MONITOR,
        ]),
    };
    args[13] = alerts;
    args[14] = writer;
    const service = new (HelplineListenerService as unknown as new (
      ...a: unknown[]
    ) => HelplineListenerService)(...args);
    return { service, writer, alerts };
  };
  const user = { id: 9, tenantId: TENANT.id };

  it('stores the note staff-only and encrypted-at-rest, alerts with requestedBy, returns the count', async () => {
    const { service, writer, alerts } = build();
    await expect(
      service.alertSupervisor(
        TENANT,
        CHAT_ID,
        user,
        '  they mentioned pills  ',
      ),
    ).resolves.toEqual({ alertedCount: 2 });
    expect(writer.staffOnly).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      HelplineMessageType.SYSTEM,
      'they mentioned pills',
      null,
      expect.objectContaining({
        systemKind: HelplineStaffSystemKind.SUPERVISOR_REQUESTED,
        senderUserId: 9,
      }),
    );
    // The note never travels with the alert.
    expect(
      JSON.stringify(alerts.listenerRequestedHelp.mock.calls),
    ).not.toContain('pills');
    expect(alerts.listenerRequestedHelp).toHaveBeenCalledWith(
      expect.objectContaining({ id: CHAT_ID }),
      9,
    );
  });

  it('0 when the org has no supervisor (the UI must say so)', async () => {
    const { service } = build({ recipients: 0 });
    await expect(
      service.alertSupervisor(TENANT, CHAT_ID, user),
    ).resolves.toEqual({
      alertedCount: 0,
    });
  });

  it('only the listener of record (a monitoring supervisor is 403)', async () => {
    const { service, alerts } = build({ access: 'MONITOR' });
    await expect(
      service.alertSupervisor(TENANT, CHAT_ID, user),
    ).rejects.toMatchObject({ status: 403 });
    expect(alerts.listenerRequestedHelp).not.toHaveBeenCalled();
  });

  it('not on an ended chat (409)', async () => {
    const { service } = build({ status: HelplineChatStatus.ENDED });
    await expect(
      service.alertSupervisor(TENANT, CHAT_ID, user),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('a note over 300 characters is a 400', async () => {
    const { service } = build();
    await expect(
      service.alertSupervisor(TENANT, CHAT_ID, user, 'x'.repeat(301)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('the SUPERVISOR_REQUESTED kind is staff-only (never talker-visible)', () => {
    expect(Object.values(HelplineGuestSystemKind)).not.toContain(
      HelplineStaffSystemKind.SUPERVISOR_REQUESTED,
    );
    expect(HelplineAccess.LISTENER).toBe('LISTENER');
  });
});

describe('lifecycle sweep: listener gone ≥ 10 min', () => {
  it('alerts once per chat through the alert service (in-app included)', async () => {
    // Imported lazily: the sweep module pulls in the whole service graph.
    const { HelplineLifecycleService } =
      await import('../helpline-lifecycle.service');
    const alerts = {
      listenerDisconnected: jest
        .fn()
        .mockResolvedValue({ recipients: 1, deduped: false }),
    };
    const flags = [true, false];
    const presence = {
      setFlagOnce: jest.fn(async () => flags.shift() ?? false),
    };
    const args: unknown[] = Array(11).fill({});
    args[2] = presence;
    args[10] = alerts;
    const sweep = new (HelplineLifecycleService as unknown as new (
      ...a: unknown[]
    ) => { apply: (...a: unknown[]) => Promise<void> })(...args);
    const chat = { id: CHAT_ID, tenantId: TENANT.id, listenerId: 7 };
    await sweep.apply(chat, { type: 'LISTENER_GONE_ALERT' }, new Date());
    await sweep.apply(chat, { type: 'LISTENER_GONE_ALERT' }, new Date());
    expect(alerts.listenerDisconnected).toHaveBeenCalledTimes(1);
    expect(alerts.listenerDisconnected).toHaveBeenCalledWith(chat);
  });
});
