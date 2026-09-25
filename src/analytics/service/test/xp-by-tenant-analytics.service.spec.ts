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
});
