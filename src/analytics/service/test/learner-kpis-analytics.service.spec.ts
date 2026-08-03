import { Test, TestingModule } from '@nestjs/testing';
import { LearnerKpisAnalyticsService } from '../learner-kpis-analytics.service';
import {
  LearnerActivitySummary,
  LearnerKpisAnalyticsRepository,
  LearnerSignupMonthRow,
} from '../../repository/learner-kpis-analytics.repository';

describe('LearnerKpisAnalyticsService', () => {
  let service: LearnerKpisAnalyticsService;
  let repository: jest.Mocked<LearnerKpisAnalyticsRepository>;

  const setup = async (
    activity: LearnerActivitySummary = {
      activeLearners: 0,
      totalCompletedSessions: 0,
    },
    signups: LearnerSignupMonthRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LearnerKpisAnalyticsService,
        {
          provide: LearnerKpisAnalyticsRepository,
          useValue: {
            getActivitySummary: jest.fn().mockResolvedValue(activity),
            getSignupsByMonth: jest.fn().mockResolvedValue(signups),
          },
        },
      ],
    }).compile();

    service = module.get(LearnerKpisAnalyticsService);
    repository = module.get(LearnerKpisAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('derives totalLearners as the sum of monthly signups and cumulates them in order', async () => {
    await setup({ activeLearners: 5, totalCompletedSessions: 40 }, [
      { month: '2024-01-01', newLearners: 3 },
      { month: '2024-02-01', newLearners: 2 },
    ]);

    const result = await service.getLearnerKpis({});

    expect(result.summary.totalLearners).toBe(5);
    expect(result.signupsByMonth).toEqual([
      { month: '2024-01-01', newLearners: 3, cumulativeLearners: 3 },
      { month: '2024-02-01', newLearners: 2, cumulativeLearners: 5 },
    ]);
  });

  it('passes activeLearners/totalCompletedSessions through unchanged', async () => {
    await setup({ activeLearners: 7, totalCompletedSessions: 123 });

    const result = await service.getLearnerKpis({});

    expect(result.summary.activeLearners).toBe(7);
    expect(result.summary.totalCompletedSessions).toBe(123);
  });

  it('trims a blank tenantId to undefined and reports platform-wide scoping', async () => {
    await setup();

    const result = await service.getLearnerKpis({ tenantId: '  ' });

    expect(repository.getActivitySummary).toHaveBeenCalledWith(undefined);
    expect(repository.getSignupsByMonth).toHaveBeenCalledWith(undefined);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('forwards a real tenantId to both repository calls and echoes it in scoping', async () => {
    await setup();

    const result = await service.getLearnerKpis({ tenantId: 'tenant-1' });

    expect(repository.getActivitySummary).toHaveBeenCalledWith('tenant-1');
    expect(repository.getSignupsByMonth).toHaveBeenCalledWith('tenant-1');
    expect(result.scoping.tenantId).toBe('tenant-1');
  });
});
