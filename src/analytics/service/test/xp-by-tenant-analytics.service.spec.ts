import { Test, TestingModule } from '@nestjs/testing';

import { XpByTenantAnalyticsService } from '../xp-by-tenant-analytics.service';
import { XpByTenantAnalyticsRepository } from '../../repository/xp-by-tenant-analytics.repository';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-01-01T00:00:00.000Z');

const tenant = (n: number, xp: number) => ({
  tenantId: `tenant-${n}`,
  tenantName: `Tenant ${n}`,
  xp,
});

describe('XpByTenantAnalyticsService', () => {
  let service: XpByTenantAnalyticsService;
  let repo: jest.Mocked<XpByTenantAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<XpByTenantAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getXpByTenant: jest.fn().mockResolvedValue([]),
      getXpByTenantByPeriod: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XpByTenantAnalyticsService,
        { provide: XpByTenantAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(XpByTenantAnalyticsService);
    repo = module.get(XpByTenantAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to a trailing 90 days', async () => {
      const res = await service.getXpByTenant({});

      expect(res.window).toMatchObject({
        window: '90d',
        to: '2024-06-12',
        from: '2024-03-15',
        allTime: false,
      });
      expect(repo.getDataFloor).not.toHaveBeenCalled();
    });

    it('resolves each trailing window to the right span', async () => {
      const res30 = await service.getXpByTenant({ window: '30d' });
      expect(res30.window.from).toBe('2024-05-14');

      const res365 = await service.getXpByTenant({ window: '365d' });
      expect(res365.window.from).toBe('2023-06-14');
    });

    it('measures the platform data floor only for window=all', async () => {
      const res = await service.getXpByTenant({ window: 'all' });

      expect(repo.getDataFloor).toHaveBeenCalled();
      expect(res.window).toMatchObject({
        window: 'all',
        from: '2024-01-01',
        allTime: true,
      });
    });
  });

  describe('segment capping', () => {
    it('returns every tenant uncapped when at or under the cap', async () => {
      const rows = Array.from({ length: 8 }, (_, i) => tenant(i, 100 - i));
      repo.getXpByTenant.mockResolvedValue(rows);

      const res = await service.getXpByTenant({});

      expect(res.segments).toHaveLength(8);
      expect(res.otherXp).toBe(0);
      expect(res.totalXp).toBe(rows.reduce((sum, r) => sum + r.xp, 0));
    });

    it('does not roll up a single tenant past the cap — names it instead', async () => {
      const rows = Array.from({ length: 9 }, (_, i) => tenant(i, 100 - i));
      repo.getXpByTenant.mockResolvedValue(rows);

      const res = await service.getXpByTenant({});

      expect(res.segments).toHaveLength(9);
      expect(res.otherXp).toBe(0);
    });

    it('rolls the tail past the cap into otherXp once it is more than one tenant', async () => {
      const rows = Array.from({ length: 10 }, (_, i) => tenant(i, 100 - i));
      repo.getXpByTenant.mockResolvedValue(rows);

      const res = await service.getXpByTenant({});

      expect(res.segments).toHaveLength(8);
      expect(res.segments.map((s) => s.tenantId)).toEqual([
        'tenant-0',
        'tenant-1',
        'tenant-2',
        'tenant-3',
        'tenant-4',
        'tenant-5',
        'tenant-6',
        'tenant-7',
      ]);
      // tenant-8 (xp=92) + tenant-9 (xp=91)
      expect(res.otherXp).toBe(92 + 91);
      expect(res.totalXp).toBe(rows.reduce((sum, r) => sum + r.xp, 0));
    });

    it('never fabricates a positive otherXp with no tail', async () => {
      repo.getXpByTenant.mockResolvedValue([tenant(1, 500)]);
      const res = await service.getXpByTenant({});

      expect(res.segments).toEqual([tenant(1, 500)]);
      expect(res.otherXp).toBe(0);
      expect(res.totalXp).toBe(500);
    });

    it('handles an empty window with no tenants earning any XP', async () => {
      const res = await service.getXpByTenant({});

      expect(res.segments).toEqual([]);
      expect(res.otherXp).toBe(0);
      expect(res.totalXp).toBe(0);
    });
  });

  describe('grouping', () => {
    it('defaults to one all-time point equal to the window totals', async () => {
      repo.getXpByTenant.mockResolvedValue([tenant(1, 300), tenant(2, 100)]);

      const res = await service.getXpByTenant({ window: 'all' });

      expect(res.grain).toBe('all');
      expect(repo.getXpByTenantByPeriod).not.toHaveBeenCalled();
      expect(res.points).toEqual([
        {
          periodStart: '2024-01-01',
          periodLabel: 'All time',
          segments: [tenant(1, 300), tenant(2, 100)],
          otherXp: 0,
          totalXp: 400,
          inProgress: false,
        },
      ]);
    });

    it('zero-fills one point per period and flags the current one', async () => {
      repo.getXpByTenant.mockResolvedValue([tenant(1, 50)]);
      repo.getXpByTenantByPeriod.mockResolvedValue([
        { periodStart: '2024-03-01', tenantId: 'tenant-1', xp: 50 },
      ]);

      const res = await service.getXpByTenant({
        window: 'all',
        grain: 'month',
      });

      expect(repo.getXpByTenantByPeriod).toHaveBeenCalledWith(
        'month',
        DATA_FLOOR,
        new Date('2024-06-13T00:00:00.000Z'),
      );
      expect(res.points.map((p) => p.periodStart)).toEqual([
        '2024-01-01',
        '2024-02-01',
        '2024-03-01',
        '2024-04-01',
        '2024-05-01',
        '2024-06-01',
      ]);
      expect(res.points.map((p) => p.totalXp)).toEqual([0, 0, 50, 0, 0, 0]);
      expect(res.points[2]).toMatchObject({
        periodLabel: 'Mar 2024',
        segments: [{ tenantId: 'tenant-1', tenantName: 'Tenant 1', xp: 50 }],
        otherXp: 0,
      });
      expect(
        res.points.filter((p) => p.inProgress).map((p) => p.periodStart),
      ).toEqual(['2024-06-01']);
    });

    it('labels quarters and years', async () => {
      const q = await service.getXpByTenant({
        window: 'all',
        grain: 'quarter',
      });
      expect(q.points.map((p) => p.periodLabel)).toEqual([
        'Q1 2024',
        'Q2 2024',
      ]);

      const y = await service.getXpByTenant({ window: 'all', grain: 'year' });
      expect(y.points.map((p) => p.periodLabel)).toEqual(['2024']);
    });

    it('keeps the whole-window named set in every period and rolls the rest into Other', async () => {
      // 10 tenants over the window: tenants 0-7 named, 8-9 are "Other".
      repo.getXpByTenant.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => tenant(i, 100 - i)),
      );
      repo.getXpByTenantByPeriod.mockResolvedValue([
        { periodStart: '2024-06-01', tenantId: 'tenant-9', xp: 40 },
        { periodStart: '2024-06-01', tenantId: 'tenant-3', xp: 7 },
        { periodStart: '2024-06-01', tenantId: 'tenant-8', xp: 5 },
        { periodStart: '2024-06-01', tenantId: 'tenant-0', xp: 2 },
      ]);

      const res = await service.getXpByTenant({
        window: '30d',
        grain: 'month',
      });
      const june = res.points.find((p) => p.periodStart === '2024-06-01')!;

      // Named tenants in whole-window rank order, regardless of period rank.
      expect(june.segments.map((s) => s.tenantId)).toEqual([
        'tenant-0',
        'tenant-3',
      ]);
      expect(june.otherXp).toBe(45);
      expect(june.totalXp).toBe(54);
    });
  });
});
