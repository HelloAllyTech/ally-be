import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';

import { SHIP_VOLUME_REPOS } from '../../constants/ship-volume.constants';
import {
  ShipVolumeAnalyticsService,
  buildWeekAxis,
} from '../ship-volume-analytics.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** GitHub reports deletions negative; the service must flip them. */
const week = (iso: string, added: number, deleted: number) => [
  Date.parse(`${iso}T00:00:00Z`) / 1000,
  added,
  -deleted,
];

describe('ShipVolumeAnalyticsService', () => {
  let service: ShipVolumeAnalyticsService;
  let redis: { get: jest.Mock; set: jest.Mock };

  const respondPerRepo = (byRepo: Record<string, unknown>) => {
    mockedAxios.get.mockImplementation((url: string) => {
      const repo = SHIP_VOLUME_REPOS.find((r) =>
        url.includes(`/repos/HelloAllyTech/${r}/`),
      );
      const data = repo && repo in byRepo ? byRepo[repo] : [];
      return Promise.resolve({ data, status: Array.isArray(data) ? 200 : 202 });
    });
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipVolumeAnalyticsService,
        {
          provide: AppConfigService,
          useValue: { githubToken: 'token', githubOrg: 'HelloAllyTech' },
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(ShipVolumeAnalyticsService);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-04T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  describe('buildWeekAxis', () => {
    it('anchors on Sunday and ends with the week now falls in', () => {
      // 2026-09-04 is a Friday; its week began Sunday 2026-08-30.
      const axis = buildWeekAxis(new Date('2026-09-04T12:00:00Z'), 3);
      expect(axis).toEqual(['2026-08-16', '2026-08-23', '2026-08-30']);
    });

    it('treats a Sunday as the first day of its own week, not the last', () => {
      const axis = buildWeekAxis(new Date('2026-08-30T00:30:00Z'), 2);
      expect(axis).toEqual(['2026-08-23', '2026-08-30']);
    });
  });

  it('sums repos into one axis and flips deletions positive', async () => {
    respondPerRepo({
      'ally-be': [week('2026-08-30', 1000, 200)],
      'ally-web': [week('2026-08-30', 500, 100)],
    });

    const result = await service.getShipVolume({ weeks: 12 });
    const current = result.weeks[result.weeks.length - 1];

    expect(current.weekStart).toBe('2026-08-30');
    expect(current.added).toBe(1500);
    expect(current.deleted).toBe(300);
    expect(current.churn).toBe(1800);
    expect(result.plotted.churn).toBe(1800);
  });

  it('returns a dense axis, so a week nobody pushed in is a zero and not a gap', async () => {
    respondPerRepo({ 'ally-be': [week('2026-08-30', 10, 0)] });

    const result = await service.getShipVolume({ weeks: 12 });

    expect(result.weeks).toHaveLength(12);
    expect(result.weeks.map((w) => w.weekStart)).toEqual(
      buildWeekAxis(new Date('2026-09-04T12:00:00Z'), 12),
    );
    expect(result.weeks[0]).toMatchObject({ churn: 0, repos: [] });
  });

  it('flags only the current week as partial', async () => {
    respondPerRepo({ 'ally-be': [week('2026-08-23', 10, 0), week('2026-08-30', 10, 0)] });

    const result = await service.getShipVolume({ weeks: 12 });

    expect(result.weeks.filter((w) => w.partial).map((w) => w.weekStart)).toEqual([
      '2026-08-30',
    ]);
    expect(result.currentWeekStart).toBe('2026-08-30');
  });

  it('ignores weeks outside the requested window', async () => {
    respondPerRepo({
      'ally-be': [week('2025-01-05', 999_999, 0), week('2026-08-30', 10, 0)],
    });

    const result = await service.getShipVolume({ weeks: 12 });

    expect(result.plotted.churn).toBe(10);
  });

  it('ranks the repo domain on window-wide churn, so no band moves per week', async () => {
    respondPerRepo({
      // ally-web wins the window; ally-be wins the last week on its own.
      'ally-web': [week('2026-08-23', 5000, 0), week('2026-08-30', 10, 0)],
      'ally-be': [week('2026-08-30', 900, 0)],
    });

    const result = await service.getShipVolume({ weeks: 12 });
    const current = result.weeks[result.weeks.length - 1];

    expect(result.repos).toEqual(['ally-web', 'ally-be']);
    expect(current.repos.map((r) => r.repo)).toEqual(['ally-web', 'ally-be']);
  });

  it('omits a repo with no churn in the window rather than sending an empty band', async () => {
    respondPerRepo({ 'ally-be': [week('2026-08-30', 10, 0)] });

    const result = await service.getShipVolume({ weeks: 12 });

    expect(result.repos).toEqual(['ally-be']);
    expect(result.repos).not.toContain('ally-web');
  });

  describe('when GitHub is still computing a repo (202)', () => {
    it('serves the cached series and says it did', async () => {
      respondPerRepo({ 'ally-be': [week('2026-08-30', 10, 0)], 'ally-web': {} });
      redis.get.mockImplementation((key: string) =>
        Promise.resolve(
          key.endsWith('ally-web') ? JSON.stringify([week('2026-08-30', 700, 100)]) : null,
        ),
      );

      const result = await service.getShipVolume({ weeks: 12 });
      const current = result.weeks[result.weeks.length - 1];

      expect(current.churn).toBe(810);
      expect(result.unavailableRepos).toContainEqual({
        repo: 'ally-web',
        reason: 'computing',
        servedFromCache: true,
      });
    });

    it('reports the repo as absent from the axis when there is no cache to fall back on', async () => {
      respondPerRepo({ 'ally-be': [week('2026-08-30', 10, 0)], 'ally-web': {} });

      const result = await service.getShipVolume({ weeks: 12 });

      expect(result.unavailableRepos).toContainEqual({
        repo: 'ally-web',
        reason: 'computing',
        servedFromCache: false,
      });
      expect(result.repos).not.toContain('ally-web');
    });
  });

  it('caches a successful series so the next 202 has something to serve', async () => {
    respondPerRepo({ 'ally-be': [week('2026-08-30', 10, 0)] });

    await service.getShipVolume({ weeks: 12 });

    expect(redis.set).toHaveBeenCalledWith(
      'analytics:ship-volume:code-frequency:ally-be',
      JSON.stringify([week('2026-08-30', 10, 0)]),
      expect.any(Number),
    );
  });

  it('degrades one unreachable repo instead of failing the chart', async () => {
    mockedAxios.get.mockImplementation((url: string) =>
      url.includes('ally-web')
        ? Promise.reject(new Error('403 rate limited'))
        : Promise.resolve({
            data: url.includes('ally-be') ? [week('2026-08-30', 10, 0)] : [],
            status: 200,
          }),
    );

    const result = await service.getShipVolume({ weeks: 12 });

    expect(result.plotted.churn).toBe(10);
    expect(result.unavailableRepos).toContainEqual({
      repo: 'ally-web',
      reason: 'unreachable',
      servedFromCache: false,
    });
  });

  it('reports every repo as not_configured when there is no token, without calling GitHub', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ShipVolumeAnalyticsService,
        {
          provide: AppConfigService,
          useValue: { githubToken: '', githubOrg: 'HelloAllyTech' },
        },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    const result = await module
      .get(ShipVolumeAnalyticsService)
      .getShipVolume({ weeks: 12 });

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result.unavailableRepos).toHaveLength(SHIP_VOLUME_REPOS.length);
    expect(result.unavailableRepos.every((r) => r.reason === 'not_configured')).toBe(
      true,
    );
    expect(result.weeks).toHaveLength(12);
    expect(result.plotted.churn).toBe(0);
  });

  it('never scopes to a tenant — this measures our own engineering', async () => {
    respondPerRepo({ 'ally-be': [week('2026-08-30', 10, 0)] });

    const result = await service.getShipVolume({ weeks: 12 });

    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });
});
