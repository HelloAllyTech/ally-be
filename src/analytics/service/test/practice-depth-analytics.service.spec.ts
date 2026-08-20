import { Test, TestingModule } from '@nestjs/testing';

import { PracticeDepthAnalyticsService } from '../practice-depth-analytics.service';
import {
  ActiveDayHistogramRow,
  MIN_STICKINESS_POPULATION,
  PracticeDepthAnalyticsRepository,
  QUALIFYING_MINUTES,
  QualifiedSessionBucketRow,
  STICKINESS_STEPS,
} from '../../repository/practice-depth-analytics.repository';

const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');

describe('PracticeDepthAnalyticsService', () => {
  let service: PracticeDepthAnalyticsService;

  const setup = async (
    histogram: ActiveDayHistogramRow[] = [],
    sessionRows: QualifiedSessionBucketRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PracticeDepthAnalyticsService,
        {
          provide: PracticeDepthAnalyticsRepository,
          useValue: {
            getActiveDayHistogram: jest.fn().mockResolvedValue(histogram),
            getQualifiedSessionsByBucket: jest
              .fn()
              .mockResolvedValue(sessionRows),
            getDataFloor: jest
              .fn()
              .mockResolvedValue(new Date('2024-01-01T00:00:00.000Z')),
          },
        },
      ],
    }).compile();

    service = module.get(PracticeDepthAnalyticsService);
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the stickiness funnel', () => {
    /** 100 learners once, 60 twice, 40 three times, 10 with twenty days. */
    const histogram: ActiveDayHistogramRow[] = [
      { activeDays: 1, learners: 40 },
      { activeDays: 2, learners: 20 },
      { activeDays: 3, learners: 30 },
      { activeDays: 20, learners: 10 },
    ];

    it('is a suffix sum, so each step counts "at least N days"', async () => {
      await setup(histogram);
      const result = await service.getStickiness({});

      expect(result.steps[0].learners).toBe(100);
      expect(result.steps[1].learners).toBe(60);
      expect(result.steps[2].learners).toBe(40);
      // Only the 20-day group survives past step 3.
      expect(result.steps[3].learners).toBe(10);
    });

    it('can only narrow', async () => {
      await setup(histogram);
      const result = await service.getStickiness({});

      const counts = result.steps.map((s) => s.learners);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });

    it('states both conversions against the right denominators', async () => {
      await setup(histogram);
      const result = await service.getStickiness({});

      expect(result.steps[1].ofTopPct).toBe(60);
      expect(result.steps[1].ofPreviousPct).toBe(60);
      expect(result.steps[2].ofTopPct).toBe(40);
      // 40 of the 60 who came back once — not 40% of the top.
      expect(result.steps[2].ofPreviousPct).toBeCloseTo(66.7, 1);
    });

    it('shows the requested number of rungs plus a reconciling tail', async () => {
      await setup(histogram);
      const result = await service.getStickiness({});

      expect(result.steps).toHaveLength(STICKINESS_STEPS);
      // The 10 learners with twenty days are past the last rung and must still
      // be accounted for somewhere.
      expect(result.beyondLastStep).toBe(10);
    });

    it('suppresses shares below the population floor but keeps the counts', async () => {
      await setup([{ activeDays: 1, learners: MIN_STICKINESS_POPULATION - 1 }]);
      const result = await service.getStickiness({});

      expect(result.steps[0].learners).toBe(MIN_STICKINESS_POPULATION - 1);
      expect(result.steps[0].ofTopPct).toBeNull();
      expect(result.steps[1].ofTopPct).toBeNull();
      expect(result.steps[1].ofPreviousPct).toBeNull();
      expect(result.medianActiveDays).toBeNull();
      expect(result.minPopulation).toBe(MIN_STICKINESS_POPULATION);
    });

    it('nulls every share on an empty platform rather than reporting 0%', async () => {
      await setup([]);
      const result = await service.getStickiness({});

      expect(result.steps[0].learners).toBe(0);
      expect(result.steps[0].ofTopPct).toBeNull();
      expect(result.beyondLastStep).toBe(0);
      expect(result.medianActiveDays).toBeNull();
    });

    it('takes the median from the skewed distribution, not the mean', async () => {
      await setup(histogram);
      const result = await service.getStickiness({});

      // Mean would be ~3.6, pulled up by the 20-day group; the typical learner
      // has 2 days.
      expect(result.medianActiveDays).toBe(2);
    });

    it('labels rungs as behaviour rather than arithmetic', async () => {
      await setup(histogram);
      const result = await service.getStickiness({});

      expect(result.steps[0].label).toBe('Practised once');
      expect(result.steps[1].label).toBe('Came back once');
      expect(result.steps[2].label).toBe('Came back 2 times');
      expect(result.qualifyingMinutes).toBe(QUALIFYING_MINUTES);
    });
  });

  describe('the qualifying-session trend', () => {
    it('gap-fills counts with real zeros and nulls the share', async () => {
      await setup(
        [],
        [
          {
            bucket: '2024-03-01',
            qualifiedSessions: 8,
            completedSessions: 10,
          },
        ],
      );
      const result = await service.getQualifiedSessions({
        range: '12m',
        bucket: 'month',
      });

      const march = result.points.find((p) => p.bucket === '2024-03-01');
      expect(march?.qualifiedSessions).toBe(8);
      expect(march?.qualifiedSharePct).toBe(80);

      // A month with no sessions: a count has a real zero, a share does not.
      const april = result.points.find((p) => p.bucket === '2024-04-01');
      expect(april?.qualifiedSessions).toBe(0);
      expect(april?.completedSessions).toBe(0);
      expect(april?.qualifiedSharePct).toBeNull();
    });

    it('totals from the raw rows, not the gap-filled axis', async () => {
      await setup(
        [],
        [
          { bucket: '2024-03-01', qualifiedSessions: 8, completedSessions: 10 },
          { bucket: '2024-04-01', qualifiedSessions: 2, completedSessions: 5 },
        ],
      );
      const result = await service.getQualifiedSessions({
        range: '12m',
        bucket: 'month',
      });

      expect(result.totalQualifiedSessions).toBe(10);
      expect(result.totalCompletedSessions).toBe(15);
    });

    it('keeps a contiguous axis over the resolved window', async () => {
      await setup([], []);
      const result = await service.getQualifiedSessions({
        range: '12m',
        bucket: 'month',
      });

      expect(result.points).toHaveLength(12);
      expect(result.bucket).toBe('month');
      const months = result.points.map((p) => p.bucket);
      expect(months).toEqual([...months].sort());
    });
  });
});
