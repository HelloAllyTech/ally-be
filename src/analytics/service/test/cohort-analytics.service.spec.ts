import { Test, TestingModule } from '@nestjs/testing';
import { CohortAnalyticsService } from '../cohort-analytics.service';
import {
  CohortActivityRow,
  CohortAnalyticsRepository,
  CohortSizeRow,
  MIN_COHORT_SIZE,
} from '../../repository/cohort-analytics.repository';

/**
 * Fixed "now" = 2024-06-12, so the current (incomplete) month is 2024-06.
 * A cohort from 2024-03 has elapsed months 1..3 -> April, May, June, with June
 * flagged partial.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

const cell = (
  cohortMonth: string,
  activityMonth: string,
  monthIndex: number,
  activeByThreshold: number[],
): CohortActivityRow => ({
  cohortMonth,
  activityMonth,
  monthIndex,
  activeByThreshold,
});

describe('CohortAnalyticsService', () => {
  let service: CohortAnalyticsService;
  let repository: jest.Mocked<CohortAnalyticsRepository>;

  const setup = async (
    sizes: CohortSizeRow[],
    activity: CohortActivityRow[],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CohortAnalyticsService,
        {
          provide: CohortAnalyticsRepository,
          useValue: {
            getCohortSizes: jest.fn().mockResolvedValue(sizes),
            getCohortActivity: jest.fn().mockResolvedValue(activity),
          },
        },
      ],
    }).compile();

    service = module.get(CohortAnalyticsService);
    repository = module.get(CohortAnalyticsRepository);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('returns the thresholds, floor and current month the client renders against', async () => {
    await setup([{ cohortMonth: '2024-06-01', learners: 9 }], []);

    const result = await service.getCohortRetention({});

    expect(result.thresholds).toEqual([10, 50, 100]);
    expect(result.minCohortSize).toBe(MIN_COHORT_SIZE);
    expect(result.currentMonth).toBe('2024-06-01');
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('never emits a month-0 cell — the signup month is the cohort itself', async () => {
    await setup(
      [{ cohortMonth: '2024-04-01', learners: 20 }],
      [cell('2024-04-01', '2024-05-01', 1, [8, 3, 1])],
    );

    const result = await service.getCohortRetention({});
    const april = result.cohorts.find((c) => c.cohortMonth === '2024-04-01');

    expect(april?.cells.map((c) => c.monthIndex)).toEqual([1, 2]);
  });

  it('stops the row at the current month rather than padding the future with zeros', async () => {
    await setup([{ cohortMonth: '2024-03-01', learners: 30 }], []);

    const result = await service.getCohortRetention({});
    const march = result.cohorts[0];

    // March + 1..3 = April, May, June. July onwards has not happened.
    expect(march.cells.map((c) => c.activityMonth)).toEqual([
      '2024-04-01',
      '2024-05-01',
      '2024-06-01',
    ]);
  });

  it('flags the current month as partial and nothing else', async () => {
    await setup([{ cohortMonth: '2024-03-01', learners: 30 }], []);

    const result = await service.getCohortRetention({});
    const partials = result.cohorts[0].cells.filter((c) => c.partial);

    expect(partials.map((c) => c.activityMonth)).toEqual(['2024-06-01']);
  });

  it('fills an elapsed month with real zeros, not with absence', async () => {
    await setup(
      [{ cohortMonth: '2024-03-01', learners: 30 }],
      [cell('2024-03-01', '2024-05-01', 2, [11, 4, 0])],
    );

    const result = await service.getCohortRetention({});
    const cells = result.cohorts[0].cells;

    expect(cells[0]).toMatchObject({
      monthIndex: 1,
      activeByThreshold: [0, 0, 0],
    });
    expect(cells[1]).toMatchObject({
      monthIndex: 2,
      activeByThreshold: [11, 4, 0],
    });
  });

  it('keeps the cohort axis a real calendar, filling signup-less months with zero', async () => {
    await setup(
      [
        { cohortMonth: '2024-02-01', learners: 12 },
        { cohortMonth: '2024-05-01', learners: 7 },
      ],
      [],
    );

    const result = await service.getCohortRetention({});

    expect(result.cohorts.map((c) => c.cohortMonth)).toEqual([
      '2024-02-01',
      '2024-03-01',
      '2024-04-01',
      '2024-05-01',
      '2024-06-01',
    ]);
    expect(result.cohorts[1]).toMatchObject({ learners: 0, cells: [] });
  });

  it('marks a cohort below the minimum group size instead of dropping it', async () => {
    await setup(
      [
        { cohortMonth: '2024-04-01', learners: MIN_COHORT_SIZE - 1 },
        { cohortMonth: '2024-05-01', learners: MIN_COHORT_SIZE },
      ],
      [],
    );

    const result = await service.getCohortRetention({});

    expect(result.cohorts[0]).toMatchObject({
      learners: MIN_COHORT_SIZE - 1,
      belowFloor: true,
    });
    expect(result.cohorts[1]).toMatchObject({ belowFloor: false });
    // A zero cohort is empty, not "below the floor" — there is nobody to expose.
    expect(result.cohorts.find((c) => c.learners === 0)?.belowFloor).toBe(
      false,
    );
  });

  it('returns an empty grid rather than a fabricated axis when there are no learners', async () => {
    await setup([], []);

    const result = await service.getCohortRetention({});

    expect(result.cohorts).toEqual([]);
  });

  it('passes the tenant filter to both the population and the activity query', async () => {
    await setup([], []);

    const result = await service.getCohortRetention({ tenantId: 'ally' });

    expect(repository.getCohortSizes).toHaveBeenCalledWith('ally');
    expect(repository.getCohortActivity).toHaveBeenCalledWith('ally');
    expect(result.scoping.tenantId).toBe('ally');
    // Nothing here has to stay platform-wide: users and user_daily_scores both
    // carry a tenant.
    expect(result.scoping.unscopedSections).toEqual([]);
  });

  it('treats a blank tenantId as no filter', async () => {
    await setup([], []);

    await service.getCohortRetention({ tenantId: '   ' });

    expect(repository.getCohortSizes).toHaveBeenCalledWith(undefined);
  });
});
