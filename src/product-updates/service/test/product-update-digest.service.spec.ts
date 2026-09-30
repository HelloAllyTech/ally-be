import { SESService } from 'src/aws/service/ses.service';
import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';

import { ProductUpdateSourceRepository } from '../../repository/product-update-source.repository';
import { ProductUpdateRepository } from '../../repository/product-update.repository';
import {
  ProductUpdateDigestService,
  escapeHtml,
} from '../product-update-digest.service';
import { ProductUpdateLivenessService } from '../product-update-liveness.service';

// 18:30 IST on 30 Sep = 13:00 UTC.
const IN_DIGEST_HOUR = new Date('2026-09-30T13:00:00Z');
const OUTSIDE_DIGEST_HOUR = new Date('2026-09-30T08:00:00Z');

const update = (overrides: Record<string, unknown>) => ({
  id: 'u1',
  title: 'Characters pause more naturally',
  summary:
    'Before replying, a character now takes a breath or says a short phrase.',
  teamNotes: '- On by default.\n- Voice agent only.',
  kind: 'improved',
  audience: 'public',
  surfaces: ['web_app', 'mobile_app'],
  area: 'Roleplays',
  confidence: 0.9,
  hidden: false,
  liveAt: new Date('2026-09-30T09:00:00Z'),
  decisionReason: null,
  sources: [
    {
      repo: 'ally-ai-learn',
      prNumber: null,
      prUrl: 'https://github.com/x/compare/a...b',
    },
  ],
  ...overrides,
});

describe('ProductUpdateDigestService', () => {
  let updateRepository: { find: jest.Mock; update: jest.Mock; save: jest.Mock };
  let sesService: { sendEmail: jest.Mock };
  let redis: {
    acquireLock: jest.Mock;
    releaseLock: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
  };
  let config: {
    productUpdates: { digestTo: string[]; digestHour: number };
    email: { sourceEmail: string };
    adminBaseUrl: string;
  };
  let service: ProductUpdateDigestService;

  beforeEach(() => {
    updateRepository = {
      find: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (rows) => rows),
    };
    sesService = { sendEmail: jest.fn().mockResolvedValue(true) };
    redis = {
      acquireLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      productUpdates: { digestTo: ['team@example.com'], digestHour: 18 },
      email: { sourceEmail: 'no-reply@example.com' },
      adminBaseUrl: 'https://admin.example.com/',
    };
    const sourceRepository = {
      countNoiseSince: jest.fn().mockResolvedValue(7),
      countByStatus: jest.fn().mockResolvedValue({
        pending: 0,
        enriched: 2,
        consolidated: 10,
        noise: 7,
      }),
    };
    const liveness = {
      pendingDeployablesFor: jest
        .fn()
        .mockResolvedValue(new Map([['u2', ['ally-web:admin']]])),
    };
    service = new ProductUpdateDigestService(
      updateRepository as unknown as ProductUpdateRepository,
      sourceRepository as unknown as ProductUpdateSourceRepository,
      liveness as unknown as ProductUpdateLivenessService,
      sesService as unknown as SESService,
      config as unknown as AppConfigService,
      redis as unknown as RedisService,
    );
  });

  it('does nothing without recipients, or outside its business hour', async () => {
    config.productUpdates.digestTo = [];
    expect(await service.sendIfDue(IN_DIGEST_HOUR)).toBe('disabled');

    config.productUpdates.digestTo = ['team@example.com'];
    expect(await service.sendIfDue(OUTSIDE_DIGEST_HOUR)).toBe('not-due');
    expect(sesService.sendEmail).not.toHaveBeenCalled();
  });

  it('sends once a day: a second tick in the same hour finds the lock taken', async () => {
    redis.acquireLock.mockResolvedValueOnce(false);

    expect(await service.sendIfDue(IN_DIGEST_HOUR)).toBe('already-sent');
  });

  it('stays quiet on a day with nothing to report', async () => {
    updateRepository.find.mockResolvedValue([]);

    expect(await service.sendIfDue(IN_DIGEST_HOUR)).toBe('nothing-to-report');
    expect(sesService.sendEmail).not.toHaveBeenCalled();
  });

  it('reports what went live and what is waiting, then marks both announced', async () => {
    const live = update({});
    const waiting = update({
      id: 'u2',
      title: 'XP per minute chart',
      audience: 'internal',
      liveAt: null,
    });
    updateRepository.find
      .mockResolvedValueOnce([live])
      .mockResolvedValueOnce([waiting]);

    expect(await service.sendIfDue(IN_DIGEST_HOUR)).toBe('sent');

    const email = sesService.sendEmail.mock.calls[0][0];
    expect(email.to).toEqual(['team@example.com']);
    expect(email.isHtml).toBe(true);
    expect(email.subject).toContain('1 live, 1 waiting');
    expect(email.body).toContain('Live for customers (1)');
    expect(email.body).toContain('waiting on the admin console');
    expect(email.body).toContain(
      '7 change(s) since the last digest were tests, docs, lint or version bumps.',
    );
    expect(email.body).toContain(
      'https://admin.example.com/product-updates?update=u1',
    );
    expect(live).toMatchObject({
      announcedLive: true,
      announcedAt: IN_DIGEST_HOUR,
    });
    expect(waiting).toMatchObject({ announcedAt: IN_DIGEST_HOUR });
  });

  it('frees the day for a retry when the email fails to send', async () => {
    updateRepository.find
      .mockResolvedValueOnce([update({})])
      .mockResolvedValueOnce([]);
    sesService.sendEmail.mockRejectedValue(new Error('SES down'));

    expect(await service.sendIfDue(IN_DIGEST_HOUR)).toBe('failed');
    expect(redis.releaseLock).toHaveBeenCalledWith(
      'product-updates:digest:2026-09-30',
    );
  });

  it('escapes what it writes into the email', () => {
    expect(escapeHtml(`<b onclick="x">Tom & Jerry's</b>`)).toBe(
      '&lt;b onclick=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;',
    );
  });
});
