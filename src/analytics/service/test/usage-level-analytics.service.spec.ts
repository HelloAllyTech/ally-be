import { Test, TestingModule } from '@nestjs/testing';
import { UsageLevelAnalyticsService } from '../usage-level-analytics.service';
import {
  MIN_USAGE_POPULATION,
  MonthlyLearnerCountRow,
  USAGE_LEVEL_BANDS,
  USAGE_LEVEL_MONTHS,
  USAGE_LEVEL_ZERO_BAND_LABEL,
  UsageLevelAnalyticsRepository,
  UsageLevelMonthRow,
} from '../../repository/usage-level-analytics.repository';

/**
 * Fixed "now" = 2024-06-12, so the current (incomplete) month is 2024-06 and the
 * axis runs 2023-06 .. 2024-06 inclusive (12 complete months + the current one).
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const bandRow = (
  month: string,
  learnersByBand: number[],
): UsageLevelMonthRow => ({
  month,
  learnersByBand,
  activeLearners: learnersByBand.reduce((a, b) => a + b, 0),
});

describe('UsageLevelAnalyticsService', () => {
  let service: UsageLevelAnalyticsService;
  let repository: jest.Mocked<UsageLevelAnalyticsRepository>;

  const setup = async (
    bandRows: UsageLevelMonthRow[] = [],
    signups: MonthlyLearnerCountRow[] = [],
    firstPractice: MonthlyLearnerCountRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsageLevelAnalyticsService,
        {
          provide: UsageLevelAnalyticsRepository,
          useValue: {
            getMonthlyBandCounts: jest.fn().mockResolvedValue(bandRows),
            getLearnerSignupsByMonth: jest.fn().mockResolvedValue(signups),
            getFirstPracticeMonths: jest.fn().mockResolvedValue(firstPractice),
          },
        },
      ],
    }).compile();

    service = module.get(UsageLevelAnalyticsService);
    repository = module.get(UsageLevelAnalyticsRepository);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('echoes the bands, the zero-band label and the current month', async () => {
    await setup();

    const result = await service.getUsageLevels({});

    expect(result.bands).toEqual(USAGE_LEVEL_BANDS);
    expect(result.zeroBandLabel).toBe(USAGE_LEVEL_ZERO_BAND_LABEL);
    expect(result.completeMonths).toBe(USAGE_LEVEL_MONTHS);
    expect(result.minPopulationSize).toBe(MIN_USAGE_POPULATION);
    expect(result.currentMonth).toBe('2024-06-01');
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('returns a gap-free monthly axis of 12 complete months plus the current one', async () => {
    await setup();

    const result = await service.getUsageLevels({});

    expect(result.months).toHaveLength(USAGE_LEVEL_MONTHS + 1);
    expect(result.months[0].month).toBe('2023-06-01');
    expect(result.months[result.months.length - 1].month).toBe('2024-06-01');
  });

  it('queries the window from the first axis month to the end of the current one', async () => {
    await setup();

    await service.getUsageLevels({});

    expect(repository.getMonthlyBandCounts).toHaveBeenCalledWith(
      new Date('2023-06-01T00:00:00.000Z'),
      new Date('2024-07-01T00:00:00.000Z'),
      undefined,
    );
  });

  it('flags the current month as partial and nothing else', async () => {
    await setup();

    const result = await service.getUsageLevels({});

    expect(result.months.filter((m) => m.partial).map((m) => m.month)).toEqual([
      '2024-06-01',
    ]);
  });

  it('fills a month with no practice with real zeros rather than dropping it', async () => {
    await setup([bandRow('2024-05-01', [4, 3, 2, 1, 0, 0, 0])]);

    const result = await service.getUsageLevels({});
    const may = result.months.find((m) => m.month === '2024-05-01');
    const april = result.months.find((m) => m.month === '2024-04-01');

    expect(may).toMatchObject({
      learnersByBand: [4, 3, 2, 1, 0, 0, 0],
      activeLearners: 10,
    });
    expect(april).toMatchObject({
      learnersByBand: USAGE_LEVEL_BANDS.map(() => 0),
      activeLearners: 0,
    });
  });

  it('cumulates signups into "learners who existed by the end of the month", including pre-window ones', async () => {
    await setup(
      [],
      [
        // Before the axis starts — these people are still in every denominator.
        { month: '2022-01-01', learners: 100 },
        { month: '2023-07-01', learners: 10 },
        { month: '2024-06-01', learners: 5 },
      ],
    );

    const result = await service.getUsageLevels({});
    const byMonth = new Map(result.months.map((m) => [m.month, m]));

    expect(byMonth.get('2023-06-01')?.registeredLearners).toBe(100);
    expect(byMonth.get('2023-07-01')?.registeredLearners).toBe(110);
    expect(byMonth.get('2024-05-01')?.registeredLearners).toBe(110);
    // The current month includes the people who joined during it.
    expect(byMonth.get('2024-06-01')?.registeredLearners).toBe(115);
  });

  it('cumulates first-practice months into the activated-learner denominator', async () => {
    await setup(
      [],
      [{ month: '2023-01-01', learners: 50 }],
      [
        { month: '2023-01-01', learners: 6 },
        { month: '2024-01-01', learners: 4 },
      ],
    );

    const result = await service.getUsageLevels({});
    const byMonth = new Map(result.months.map((m) => [m.month, m]));

    expect(byMonth.get('2023-12-01')?.activatedLearners).toBe(6);
    expect(byMonth.get('2024-01-01')?.activatedLearners).toBe(10);
    // The two denominators are independent: never-activated learners stay in the
    // registered count and out of the activated one.
    expect(byMonth.get('2024-01-01')?.registeredLearners).toBe(50);
  });

  it('reports zero denominators for months before the population existed', async () => {
    await setup([], [{ month: '2024-03-01', learners: 8 }]);

    const result = await service.getUsageLevels({});
    const byMonth = new Map(result.months.map((m) => [m.month, m]));

    // A share of nobody is undefined, not zero — the client drops these months.
    expect(byMonth.get('2024-02-01')?.registeredLearners).toBe(0);
    expect(byMonth.get('2024-03-01')?.registeredLearners).toBe(8);
  });

  it('passes the tenant filter to the population and the activity queries alike', async () => {
    await setup();

    const result = await service.getUsageLevels({ tenantId: 'ally' });

    expect(repository.getMonthlyBandCounts).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(Date),
      'ally',
    );
    expect(repository.getLearnerSignupsByMonth).toHaveBeenCalledWith('ally');
    expect(repository.getFirstPracticeMonths).toHaveBeenCalledWith('ally');
    expect(result.scoping.tenantId).toBe('ally');
    expect(result.scoping.unscopedSections).toEqual([]);
  });

  it('treats a blank tenantId as no filter', async () => {
    await setup();

    await service.getUsageLevels({ tenantId: '   ' });

    expect(repository.getLearnerSignupsByMonth).toHaveBeenCalledWith(undefined);
  });
});
