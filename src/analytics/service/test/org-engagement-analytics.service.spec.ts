import { Test, TestingModule } from '@nestjs/testing';

import { OrgEngagementAnalyticsService } from '../org-engagement-analytics.service';
import {
  DEFAULT_ORG_ACTIVITY_WINDOW,
  OrgActivityMonthRow,
  OrgActivityWindowRow,
  OrgEngagementAnalyticsRepository,
} from '../../repository/org-engagement-analytics.repository';

describe('OrgEngagementAnalyticsService', () => {
  let service: OrgEngagementAnalyticsService;
  let repository: jest.Mocked<OrgEngagementAnalyticsRepository>;

  const setup = async (
    orgs = 0,
    activityRow: OrgActivityWindowRow = { activeOrgs: 0, totalOrgs: 0 },
    trendRows: OrgActivityMonthRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgEngagementAnalyticsService,
        {
          provide: OrgEngagementAnalyticsRepository,
          useValue: {
            getOrgCount: jest.fn().mockResolvedValue(orgs),
            getActivityWindow: jest.fn().mockResolvedValue(activityRow),
            getActivityByMonth: jest.fn().mockResolvedValue(trendRows),
          },
        },
      ],
    }).compile();

    service = module.get(OrgEngagementAnalyticsService);
    repository = module.get(OrgEngagementAnalyticsRepository);
  };

  it('reports the org count', async () => {
    await setup(40);
    const result = await service.getOrgEngagement({});

    expect(result.orgs).toBe(40);
  });

  describe('recent activity', () => {
    it('defaults to the 28-day window and passes it through', async () => {
      await setup(undefined, { activeOrgs: 12, totalOrgs: 30 });
      const result = await service.getOrgEngagement({});

      expect(result.activityDays).toBe(DEFAULT_ORG_ACTIVITY_WINDOW);
      expect(repository.getActivityWindow).toHaveBeenCalledWith(
        DEFAULT_ORG_ACTIVITY_WINDOW,
      );
      expect(result.activeOrgs).toBe(12);
      expect(result.eligibleOrgs).toBe(30);
      expect(result.activeSharePct).toBe(40);
    });

    it('honours a requested window', async () => {
      await setup(undefined, { activeOrgs: 5, totalOrgs: 30 });
      const result = await service.getOrgEngagement({ activityDays: 7 });

      expect(result.activityDays).toBe(7);
      expect(repository.getActivityWindow).toHaveBeenCalledWith(7);
    });

    it('nulls the share when no org was eligible for the window', async () => {
      await setup(undefined, { activeOrgs: 0, totalOrgs: 0 });
      const result = await service.getOrgEngagement({});

      expect(result.activeSharePct).toBeNull();
    });

    it('computes a share per month on the trend', async () => {
      await setup(undefined, undefined, [
        { month: '2024-04-01', activeOrgs: 4, totalOrgs: 10 },
        { month: '2024-05-01', activeOrgs: 0, totalOrgs: 0 },
      ]);
      const result = await service.getOrgEngagement({});

      expect(result.activityTrend[0].activeSharePct).toBe(40);
      // No org existed yet: the share is undefined, not 0%.
      expect(result.activityTrend[1].activeSharePct).toBeNull();
    });
  });

  it('ignores tenantId and names the sections that stayed platform-wide', async () => {
    await setup(40);
    const result = await service.getOrgEngagement({ tenantId: 'acme' });

    // Counting ORGS cannot be narrowed to one org, so rather than silently
    // returning platform numbers under a filter that reads as applied, the
    // response says so.
    expect(result.scoping.tenantId).toBeNull();
    expect(result.scoping.unscopedSections).toEqual(
      expect.arrayContaining(['orgs', 'activeOrgs', 'activityTrend']),
    );
    expect(result.orgs).toBe(40);
  });
});
