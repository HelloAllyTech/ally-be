import { Test, TestingModule } from '@nestjs/testing';
import { OrgSessionDistributionAnalyticsService } from '../org-session-distribution-analytics.service';
import { MIN_ORG_GROUP_SIZE } from '../../repository/highlights-analytics.repository';
import {
  ORG_AVG_MINUTES_BANDS,
  ORG_AVG_SESSIONS_BANDS,
  OrgDistributionResult,
  OrgSessionDistributionAnalyticsRepository,
} from '../../repository/org-session-distribution-analytics.repository';

describe('OrgSessionDistributionAnalyticsService', () => {
  let service: OrgSessionDistributionAnalyticsService;
  let repository: jest.Mocked<OrgSessionDistributionAnalyticsRepository>;

  const setup = async (
    timeResult: OrgDistributionResult = { totalOrgs: 0, orgsByBand: [] },
    frequencyResult: OrgDistributionResult = { totalOrgs: 0, orgsByBand: [] },
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgSessionDistributionAnalyticsService,
        {
          provide: OrgSessionDistributionAnalyticsRepository,
          useValue: {
            getTimeDistribution: jest.fn().mockResolvedValue(timeResult),
            getFrequencyDistribution: jest
              .fn()
              .mockResolvedValue(frequencyResult),
          },
        },
      ],
    }).compile();

    service = module.get(OrgSessionDistributionAnalyticsService);
    repository = module.get(OrgSessionDistributionAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('labels each band from the repository-declared band list, at or above the floor', async () => {
    await setup(
      {
        totalOrgs: MIN_ORG_GROUP_SIZE,
        orgsByBand: ORG_AVG_MINUTES_BANDS.map((_, i) => i + 1),
      },
      {
        totalOrgs: MIN_ORG_GROUP_SIZE,
        orgsByBand: ORG_AVG_SESSIONS_BANDS.map(() => 1),
      },
    );

    const result = await service.getDistribution({});

    expect(result.avgMinutesPerLearner.shown).toBe(true);
    expect(result.avgMinutesPerLearner.bands).toEqual(
      ORG_AVG_MINUTES_BANDS.map((b, i) => ({ label: b.label, orgs: i + 1 })),
    );
    expect(result.avgSessionsPerLearner.bands).toHaveLength(
      ORG_AVG_SESSIONS_BANDS.length,
    );
  });

  it('suppresses bands (but keeps totalOrgs) below the min-group-size floor', async () => {
    await setup(
      { totalOrgs: MIN_ORG_GROUP_SIZE - 1, orgsByBand: [1, 1, 0, 0, 0] },
      { totalOrgs: MIN_ORG_GROUP_SIZE - 1, orgsByBand: [1, 1, 0, 0, 0] },
    );

    const result = await service.getDistribution({});

    expect(result.avgMinutesPerLearner.shown).toBe(false);
    expect(result.avgMinutesPerLearner.bands).toEqual([]);
    expect(result.avgMinutesPerLearner.totalOrgs).toBe(MIN_ORG_GROUP_SIZE - 1);
    expect(result.avgSessionsPerLearner.shown).toBe(false);
    expect(result.avgSessionsPerLearner.bands).toEqual([]);
  });

  it('trims a blank tenantId to undefined and reports platform-wide scoping', async () => {
    await setup();

    const result = await service.getDistribution({ tenantId: '  ' });

    expect(repository.getTimeDistribution).toHaveBeenCalledWith(undefined);
    expect(repository.getFrequencyDistribution).toHaveBeenCalledWith(undefined);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('forwards a real tenantId to both repository calls and echoes it in scoping', async () => {
    await setup();

    const result = await service.getDistribution({ tenantId: 'tenant-1' });

    expect(repository.getTimeDistribution).toHaveBeenCalledWith('tenant-1');
    expect(repository.getFrequencyDistribution).toHaveBeenCalledWith(
      'tenant-1',
    );
    expect(result.scoping.tenantId).toBe('tenant-1');
  });
});
