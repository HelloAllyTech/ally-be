import { Test, TestingModule } from '@nestjs/testing';

import { OrgEngagementAnalyticsService } from '../org-engagement-analytics.service';
import {
  DEFAULT_ORG_ACTIVITY_WINDOW,
  ORG_LADDER_LEVELS,
  OrgActivityMonthRow,
  OrgActivityWindowRow,
  OrgEngagementAnalyticsRepository,
  OrgLadderFunnelRow,
} from '../../repository/org-engagement-analytics.repository';

describe('OrgEngagementAnalyticsService', () => {
  let service: OrgEngagementAnalyticsService;
  let repository: jest.Mocked<OrgEngagementAnalyticsRepository>;

  const setup = async (
    funnelRow: OrgLadderFunnelRow = {
      orgs: 0,
      atLevel: ORG_LADDER_LEVELS.map(() => 0),
    },
    activityRow: OrgActivityWindowRow = { activeOrgs: 0, totalOrgs: 0 },
    trendRows: OrgActivityMonthRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgEngagementAnalyticsService,
        {
          provide: OrgEngagementAnalyticsRepository,
          useValue: {
            getFunnel: jest.fn().mockResolvedValue(funnelRow),
            getActivityWindow: jest.fn().mockResolvedValue(activityRow),
            getActivityByMonth: jest.fn().mockResolvedValue(trendRows),
          },
        },
      ],
    }).compile();

    service = module.get(OrgEngagementAnalyticsService);
    repository = module.get(OrgEngagementAnalyticsRepository);
  };

  describe('the ladder funnel', () => {
    it('nests and states both conversions', async () => {
      await setup({ orgs: 40, atLevel: [20, 8, 2, 1] });
      const result = await service.getOrgEngagement({});

      expect(result.funnel.map((s) => s.id)).toEqual([
        'orgs',
        ...ORG_LADDER_LEVELS.map((l) => l.id),
      ]);
      expect(result.funnel.map((s) => s.orgs)).toEqual([40, 20, 8, 2, 1]);
      expect(result.funnel[1].ofTopPct).toBe(50);
      expect(result.funnel[2].ofTopPct).toBe(20);
      // 8 of the 20 that reached L1.
      expect(result.funnel[2].ofPreviousPct).toBe(40);
    });

    it('keeps small counts visible — an org is not a person', async () => {
      // The learner funnels suppress shares over a handful of people; this one
      // deliberately does not, because the population is companies.
      await setup({ orgs: 6, atLevel: [2, 1, 0, 0] });
      const result = await service.getOrgEngagement({});

      expect(result.funnel[1].orgs).toBe(2);
      expect(result.funnel[1].ofTopPct).toBeCloseTo(33.3, 1);
    });

    it('nulls conversions on an empty platform rather than reporting 0%', async () => {
      await setup();
      const result = await service.getOrgEngagement({});

      expect(result.funnel[0].ofTopPct).toBeNull();
      expect(result.funnel[1].ofTopPct).toBeNull();
      expect(result.funnel[0].ofPreviousPct).toBeNull();
    });
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
    await setup({ orgs: 40, atLevel: [20, 8, 2, 1] });
    const result = await service.getOrgEngagement({ tenantId: 'acme' });

    // Counting ORGS cannot be narrowed to one org, so rather than silently
    // returning platform numbers under a filter that reads as applied, the
    // response says so.
    expect(result.scoping.tenantId).toBeNull();
    expect(result.scoping.unscopedSections).toEqual(
      expect.arrayContaining(['funnel', 'activeOrgs', 'activityTrend']),
    );
    expect(result.funnel[0].orgs).toBe(40);
  });

  it('echoes the ladder so labels are built from the server definition', async () => {
    await setup();
    const result = await service.getOrgEngagement({});

    expect(result.levels).toEqual(ORG_LADDER_LEVELS);
    expect(result.levels.map((l) => l.minMinutes)).toEqual([
      500, 5000, 25000, 100000,
    ]);
  });
});
