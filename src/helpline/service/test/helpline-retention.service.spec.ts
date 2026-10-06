import { IsNull } from 'typeorm';
import { testCipher } from './helpline-test-cipher';
import { HELPLINE_DEFAULT_SETTINGS } from '../../constants/helpline-settings.defaults';
import {
  HelplineChatEventType,
  HelplineChatStatus,
  HelplineEndedReason,
} from '../../constants/helpline.constants';
import { HelplineMessageRepository } from '../../repository/helpline-message.repository';
import { HelplineGuestService } from '../helpline-guest.service';
import { HelplineRetentionService } from '../helpline-retention.service';

const TENANT = { id: 't-1', code: 'acme', name: 'Acme', logoUrl: null };
const NOW = new Date('2026-10-05T12:00:00Z');

function build(
  retentionDays: number,
  batches: { id: string; talkerId: string }[][] = [],
) {
  const chats = {
    listRetentionTenantIdsAcrossTenants: jest
      .fn()
      .mockResolvedValue([TENANT.id]),
    findRetentionCandidates: jest.fn(),
    markErased: jest.fn().mockResolvedValue(undefined),
  };
  for (const batch of batches)
    chats.findRetentionCandidates.mockResolvedValueOnce(batch);
  chats.findRetentionCandidates.mockResolvedValue([]);
  const messages = { blankForChats: jest.fn().mockResolvedValue(4) };
  const repo = () => ({ update: jest.fn().mockResolvedValue({ affected: 1 }) });
  const talkers = repo();
  const feedback = repo();
  const summaries = repo();
  const flags = repo();
  const tenants = { resolve: jest.fn().mockResolvedValue(TENANT) };
  const settings = {
    getSettings: jest
      .fn()
      .mockResolvedValue({ ...HELPLINE_DEFAULT_SETTINGS, retentionDays }),
  };
  const service = new HelplineRetentionService(
    chats as never,
    messages as never,
    talkers as never,
    feedback as never,
    summaries as never,
    flags as never,
    tenants as never,
    settings as never,
  );
  return { service, chats, messages, talkers, feedback, summaries, flags };
}

const batchOf = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: `c-${offset + i}`,
    talkerId: `t-${offset + i}`,
  }));

describe('HelplineRetentionService', () => {
  it('retentionDays = 0 keeps everything and never looks for candidates', async () => {
    const { service, chats } = build(0);
    expect(await service.sweepTenant(TENANT.id, NOW)).toEqual({
      chats: 0,
      messages: 0,
    });
    expect(chats.findRetentionCandidates).not.toHaveBeenCalled();
  });

  it('blanks chats ended before the cutoff, in batches of 500, until a short batch', async () => {
    const { service, chats, messages } = build(90, [
      batchOf(500),
      batchOf(3, 500),
    ]);
    const counts = await service.sweepTenant(TENANT.id, NOW);
    expect(counts).toEqual({ chats: 503, messages: 8 });
    expect(chats.findRetentionCandidates).toHaveBeenCalledTimes(2);
    const [tenantArg, cutoff, limit] =
      chats.findRetentionCandidates.mock.calls[0];
    expect(tenantArg).toBe(TENANT.id);
    expect((cutoff as Date).toISOString()).toBe('2026-07-07T12:00:00.000Z');
    expect(limit).toBe(500);
    expect(messages.blankForChats).toHaveBeenCalledTimes(2);
  });

  it('blankChats blanks exactly the contract §10 list, tenant-scoped, and marks erased last', async () => {
    const { service, chats, messages, talkers, feedback, summaries, flags } =
      build(90);
    const order: string[] = [];
    messages.blankForChats.mockImplementation(
      async () => (order.push('messages'), 2),
    );
    chats.markErased.mockImplementation(async () => void order.push('chat'));
    await service.blankChats(TENANT.id, ['c-1'], ['t-1']);

    expect(messages.blankForChats).toHaveBeenCalledWith(TENANT.id, ['c-1']);
    expect(feedback.update.mock.calls[0][1]).toEqual({ comment: null });
    expect(summaries.update.mock.calls[0][1]).toEqual({ fields: {} });
    expect(flags.update.mock.calls[0][1]).toEqual({ outcomeNote: null });
    for (const repo of [feedback, summaries, flags, talkers]) {
      for (const [where] of repo.update.mock.calls)
        expect(where.tenantId).toBe(TENANT.id);
    }
    expect(talkers.update.mock.calls[0]).toEqual([
      expect.objectContaining({ tenantId: TENANT.id, erasedAt: IsNull() }),
      expect.objectContaining({ displayName: 'Anonymous', userAgent: null }),
    ]);
    // The ip HMAC goes unless it is holding a block in place.
    expect(talkers.update.mock.calls[1]).toEqual([
      expect.objectContaining({ blockedAt: IsNull() }),
      { ipHash: null },
    ]);
    expect(order).toEqual(['messages', 'chat']);
  });

  it('a second sweep over the same window finds nothing (candidates exclude erased chats)', async () => {
    const { service, messages } = build(90, []);
    expect(await service.sweepTenant(TENANT.id, NOW)).toEqual({
      chats: 0,
      messages: 0,
    });
    expect(messages.blankForChats).not.toHaveBeenCalled();
  });

  it('one tenant failing does not stop the sweep', async () => {
    const { service, chats } = build(90);
    chats.listRetentionTenantIdsAcrossTenants.mockResolvedValue([
      'bad',
      TENANT.id,
    ]);
    chats.findRetentionCandidates.mockRejectedValueOnce(new Error('db down'));
    await expect(service.runRetentionSweep()).resolves.toBeUndefined();
    expect(chats.findRetentionCandidates).toHaveBeenCalledTimes(2);
  });
});

describe('HelplineMessageRepository.blankForChats (idempotent SQL)', () => {
  it('blanks every type, strips suggestion text, and skips rows already blanked', async () => {
    const repo = { query: jest.fn().mockResolvedValue([[], 7]) };
    const changed = await new HelplineMessageRepository(
      repo as never,
      testCipher(),
    ).blankForChats('t-1', ['c-1']);
    const [sql, params] = repo.query.mock.calls[0];
    expect(changed).toBe(7);
    expect(sql).toContain('"content" = $3');
    expect(sql).toContain(`"metadata" - 'suggestions'`);
    expect(sql).toContain('"tenant_id" = $1 AND "chat_id" = ANY($2::uuid[])');
    expect(sql).toContain('("content" <> $3 OR "erased_at" IS NULL)');
    expect(sql).not.toMatch(/"type"\s*=/); // all types, not just TEXT
    expect(params).toEqual(['t-1', ['c-1'], '[erased]']);
  });
});

describe('HelplineGuestService.erase', () => {
  const build = (status: HelplineChatStatus) => {
    const chat = { id: 'c-1', tenantId: 't-1', status, talkerId: 'tk-1' };
    const talker = { id: 'tk-1', tenantId: 't-1' };
    const deps = {
      talkers: { update: jest.fn().mockResolvedValue({}) },
      chats: {
        findById: jest
          .fn()
          .mockResolvedValue({ ...chat, erasedAt: new Date() }),
      },
      lifecycle: {
        endChat: jest
          .fn()
          .mockResolvedValue({ ...chat, status: HelplineChatStatus.ENDED }),
      },
      retention: {
        blankChats: jest.fn().mockResolvedValue({ chats: 1, messages: 3 }),
      },
      events: { record: jest.fn().mockResolvedValue(undefined) },
      presence: { dropConnection: jest.fn().mockResolvedValue(undefined) },
      realtime: { disconnectRoom: jest.fn().mockResolvedValue(undefined) },
      notify: { chatUpdated: jest.fn().mockResolvedValue(undefined) },
    };
    const service = new HelplineGuestService(
      deps.talkers as never,
      {} as never,
      deps.chats as never,
      {} as never,
      {} as never,
      {} as never,
      deps.lifecycle as never,
      deps.retention as never,
      deps.events as never,
      deps.presence as never,
      deps.realtime as never,
      deps.notify as never,
      testCipher(),
    );
    return { service, chat, talker, ...deps };
  };

  it('ends an open chat as TALKER_ERASED, blanks it, revokes the token and drops the sockets', async () => {
    const {
      service,
      chat,
      talker,
      lifecycle,
      retention,
      talkers,
      events,
      realtime,
    } = build(HelplineChatStatus.ACTIVE);
    await service.erase({ chat, talker } as never);
    expect(lifecycle.endChat).toHaveBeenCalledWith(
      chat,
      HelplineEndedReason.TALKER_ERASED,
    );
    expect(talkers.update).toHaveBeenCalledWith(
      { id: 'tk-1', tenantId: 't-1' },
      { revokedAt: expect.any(Date) },
    );
    expect(retention.blankChats).toHaveBeenCalledWith('t-1', ['c-1'], ['tk-1']);
    expect(events.record).toHaveBeenCalledWith(
      't-1',
      'c-1',
      HelplineChatEventType.ERASURE_REQUESTED,
    );
    expect(realtime.disconnectRoom).toHaveBeenCalledWith('talker:c-1');
  });

  it('erasing an already ended chat does not end it again', async () => {
    const { service, chat, talker, lifecycle, retention } = build(
      HelplineChatStatus.ENDED,
    );
    await service.erase({ chat, talker } as never);
    expect(lifecycle.endChat).not.toHaveBeenCalled();
    expect(retention.blankChats).toHaveBeenCalled();
  });
});
