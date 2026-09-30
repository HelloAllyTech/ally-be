import { Test, TestingModule } from '@nestjs/testing';

import { XpPerMinuteAnalyticsService } from '../xp-per-minute-analytics.service';
import {
  RoleplayMinutesBucketRow,
  XpByRuleBucketRow,
  XpPerMinuteAnalyticsRepository,
} from '../../repository/xp-per-minute-analytics.repository';
import {
  XP_SOURCE_GROUP_BY_RULE,
  XP_SOURCE_GROUPS,
} from '../../constants/xp-per-minute.constants';
import { ACTIVE_XP_RULES, XP_RULE } from '../../../progress/progress.constants';

/**
 * Fixed "now" = 2024-06-12 with a data floor of 2024-04-10, so the default
 * all-time monthly axis is 2024-04-01 .. 2024-06-01.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-04-10T00:00:00.000Z');

describe('XpPerMinuteAnalyticsService', () => {
  let service: XpPerMinuteAnalyticsService;
  let repo: Record<string, jest.Mock>;

  const setup = async ({
    xp = [] as XpByRuleBucketRow[],
    minutes = [] as RoleplayMinutesBucketRow[],
  } = {}) => {
    repo = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getXpByBucketAndRule: jest.fn().mockResolvedValue(xp),
      getMinutesByBucket: jest.fn().mockResolvedValue(minutes),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpPerMinuteAnalyticsService,
        { provide: XpPerMinuteAnalyticsRepository, useValue: repo },
      ],
    }).compile();
    service = module.get(XpPerMinuteAnalyticsService);
  };

  beforeEach(() => jest.useFakeTimers().setSystemTime(FIXED_NOW));
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('maps every active XP rule to a named source (never "other")', () => {
    for (const rule of ACTIVE_XP_RULES) {
      expect(XP_SOURCE_GROUP_BY_RULE[rule]).toBeDefined();
      expect(XP_SOURCE_GROUP_BY_RULE[rule]).not.toBe('other');
    }
  });

  it('defaults to all time, monthly, with a gap-free axis', async () => {
    await setup();
    const res = await service.getXpPerMinute({});

    expect(repo.getDataFloor).toHaveBeenCalled();
    expect(res.window).toMatchObject({ allTime: true, bucket: 'month' });
    expect(res.points.map((p) => p.bucket)).toEqual([
      '2024-04-01',
      '2024-05-01',
      '2024-06-01',
    ]);
    expect(res.sources.map((s) => s.key)).toEqual([...XP_SOURCE_GROUPS]);
  });

  it('passes the requested grain through to both queries', async () => {
    await setup();
    await service.getXpPerMinute({ range: 'all', bucket: 'quarter' });

    expect(repo.getXpByBucketAndRule).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'quarter',
    );
    expect(repo.getMinutesByBucket).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'quarter',
    );
  });

  it('splits XP by source over one denominator, so the parts sum to the headline', async () => {
    await setup({
      xp: [
        { bucket: '2024-05-01', rule: XP_RULE.PRACTICE_MINUTE, xp: 80 },
        { bucket: '2024-05-01', rule: XP_RULE.SESSION_COMPLETED, xp: 20 },
        { bucket: '2024-05-01', rule: XP_RULE.TRACK_ITEM_COMPLETED, xp: 60 },
        { bucket: '2024-05-01', rule: XP_RULE.PEER_COMMENT, xp: 10 },
        { bucket: '2024-05-01', rule: XP_RULE.WEEKLY_CONSISTENCY, xp: 30 },
      ],
      minutes: [{ bucket: '2024-05-01', minutes: 100 }],
    });
    const res = await service.getXpPerMinute({});
    const may = res.points.find((p) => p.bucket === '2024-05-01')!;

    expect(may.xp).toBe(200);
    expect(may.xpPerMinute).toBe(2);
    expect(may.perMinuteBySource).toEqual({
      roleplay: 1,
      tracks: 0.6,
      community: 0.1,
      consistency: 0.3,
      other: 0,
    });
    expect(may.roleplaySharePct).toBe(50);
  });

  it('puts retired or unknown rules in "other" rather than dropping them', async () => {
    await setup({
      xp: [
        { bucket: '2024-05-01', rule: XP_RULE.STREAK_MULTIPLIER, xp: 5 },
        { bucket: '2024-05-01', rule: 'SOMETHING_NEW', xp: 5 },
      ],
      minutes: [{ bucket: '2024-05-01', minutes: 10 }],
    });
    const res = await service.getXpPerMinute({});

    expect(res.overall.xpBySource.other).toBe(10);
    expect(res.overall.xp).toBe(10);
    expect(res.overall.xpPerMinute).toBe(1);
  });

  it('returns null ratios for a period with XP but no roleplay minutes', async () => {
    await setup({
      xp: [
        { bucket: '2024-04-01', rule: XP_RULE.TRACK_ITEM_COMPLETED, xp: 30 },
      ],
    });
    const res = await service.getXpPerMinute({});
    const apr = res.points[0];

    expect(apr.xp).toBe(30);
    expect(apr.minutes).toBe(0);
    expect(apr.xpPerMinute).toBeNull();
    expect(apr.perMinuteBySource.tracks).toBeNull();
    expect(apr.roleplaySharePct).toBe(0);
    // A bucket with nothing at all has no share either.
    expect(res.points[1].roleplaySharePct).toBeNull();
  });

  it('computes overall as total XP over total minutes, not a mean of ratios', async () => {
    await setup({
      xp: [
        { bucket: '2024-04-01', rule: XP_RULE.PRACTICE_MINUTE, xp: 10 },
        { bucket: '2024-05-01', rule: XP_RULE.PRACTICE_MINUTE, xp: 300 },
      ],
      minutes: [
        { bucket: '2024-04-01', minutes: 1 }, // 10 XP/min
        { bucket: '2024-05-01', minutes: 299 }, // ~1 XP/min
      ],
    });
    const res = await service.getXpPerMinute({});

    // Mean of ratios would be ~5.5; the pooled figure is 310/300.
    expect(res.overall.xpPerMinute).toBe(1.0333);
    expect(res.overall.minutes).toBe(300);
  });
});
