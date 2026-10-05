import { HttpException } from '@nestjs/common';
import { ErrorCode } from 'src/exception/error-code.enum';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import { HELPLINE_CONSENT_VERSION } from '../../constants/helpline.constants';
import {
  HelplineSessionService,
  computeOpenState,
} from '../helpline-session.service';

const TENANT = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };

describe('computeOpenState', () => {
  const now = new Date('2026-10-05T04:30:00Z');

  it('open with an available listener and room in the queue', () => {
    expect(computeOpenState(HELPLINE_DEFAULT_SETTINGS, now, 1, 0)).toEqual({
      open: true,
      closedReason: null,
    });
  });

  it('closed with no listeners, unless queueing without listeners is allowed', () => {
    expect(
      computeOpenState(HELPLINE_DEFAULT_SETTINGS, now, 0, 0).closedReason,
    ).toBe('NO_LISTENERS');
    expect(
      computeOpenState(
        { ...HELPLINE_DEFAULT_SETTINGS, allowQueueWhenNoListeners: true },
        now,
        0,
        0,
      ).open,
    ).toBe(true);
  });

  it('closed when the queue is at its cap', () => {
    expect(
      computeOpenState(
        { ...HELPLINE_DEFAULT_SETTINGS, maxWaitingTalkers: 2 },
        now,
        3,
        2,
      ).closedReason,
    ).toBe('QUEUE_FULL');
  });

  it('outside hours wins', () => {
    const settings = {
      ...HELPLINE_DEFAULT_SETTINGS,
      hours: {
        tz: 'Asia/Kolkata',
        weekly: [{ day: 2 as const, open: '09:00', close: '17:00' }],
      },
    };
    expect(computeOpenState(settings, now, 5, 0).closedReason).toBe(
      'OUTSIDE_HOURS',
    );
  });
});

describe('HelplineSessionService.createSession refusals', () => {
  function build(
    o: {
      enabled?: boolean;
      tenant?: unknown;
      blocked?: number;
      available?: number;
      waiting?: number;
    } = {},
  ) {
    const deps = {
      dataSource: { transaction: jest.fn() },
      talkers: { count: jest.fn().mockResolvedValue(o.blocked ?? 0) },
      chats: { countWaiting: jest.fn().mockResolvedValue(o.waiting ?? 0) },
      tenants: {
        resolve: jest
          .fn()
          .mockResolvedValue(o.tenant === undefined ? TENANT : o.tenant),
      },
      settings: {
        isEnabled: jest.fn().mockResolvedValue(o.enabled ?? true),
        getSettings: jest.fn().mockResolvedValue(HELPLINE_DEFAULT_SETTINGS),
      },
      presence: {
        availableListenerIds: jest
          .fn()
          .mockResolvedValue(Array(o.available ?? 1).fill(7)),
      },
      tokens: { hashIp: jest.fn().mockReturnValue('hash') },
    };
    const service = new HelplineSessionService(
      deps.dataSource as never,
      deps.talkers as never,
      deps.chats as never,
      {} as never,
      deps.tenants as never,
      deps.settings as never,
      deps.presence as never,
      deps.tokens as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, ...deps };
  }
  const input = {
    consentVersion: HELPLINE_CONSENT_VERSION,
    language: 'en',
    ip: '203.0.113.7',
  };
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      const e = error as HttpException;
      return [
        e.getStatus(),
        (e.getResponse() as { errorCode?: string }).errorCode,
      ];
    }
    return 'created';
  };

  it('unknown code and disabled org look the same: 403 HELPLINE_DISABLED', async () => {
    expect(
      await codeOf(
        build({ tenant: null }).service.createSession('nope', input),
      ),
    ).toEqual([403, ErrorCode.HELPLINE_DISABLED]);
    expect(
      await codeOf(
        build({ enabled: false }).service.createSession('acme', input),
      ),
    ).toEqual([403, ErrorCode.HELPLINE_DISABLED]);
  });

  it('an outdated consent version is 400 HELPLINE_CONSENT_OUTDATED', async () => {
    expect(
      await codeOf(
        build().service.createSession('acme', {
          ...input,
          consentVersion: '2020-01-01',
        }),
      ),
    ).toEqual([400, ErrorCode.HELPLINE_CONSENT_OUTDATED]);
  });

  it('an ip blocked in the last 24 h is 403 HELPLINE_TALKER_BLOCKED', async () => {
    const { service, talkers } = build({ blocked: 1 });
    expect(await codeOf(service.createSession('acme', input))).toEqual([
      403,
      ErrorCode.HELPLINE_TALKER_BLOCKED,
    ]);
    expect(talkers.count.mock.calls[0][0].where).toMatchObject({
      tenantId: 't-1',
      ipHash: 'hash',
    });
  });

  it('a full queue is 503 HELPLINE_QUEUE_FULL; no listener is 409 HELPLINE_CLOSED', async () => {
    expect(
      await codeOf(
        build({
          waiting: HELPLINE_DEFAULT_SETTINGS.maxWaitingTalkers,
        }).service.createSession('acme', input),
      ),
    ).toEqual([503, ErrorCode.HELPLINE_QUEUE_FULL]);
    expect(
      await codeOf(
        build({ available: 0 }).service.createSession('acme', input),
      ),
    ).toEqual([409, ErrorCode.HELPLINE_CLOSED]);
  });

  it('status for an unknown code is { enabled: false }', async () => {
    await expect(
      build({ tenant: null }).service.status('nope'),
    ).resolves.toEqual({ enabled: false });
  });
});
