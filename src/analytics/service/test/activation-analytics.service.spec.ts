import { Test, TestingModule } from '@nestjs/testing';
import { ActivationAnalyticsService } from '../activation-analytics.service';
import {
  ACTIVATION_FUNNEL_DENOMINATOR_LABEL,
  ActivationAnalyticsRepository,
  ActivationSnapshotRow,
  MIN_ACTIVATION_POPULATION,
  TIME_TO_FIRST_PRACTICE_BANDS,
  TIME_TO_FIRST_PRACTICE_BOUNDS_NOTE,
  TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS,
} from '../../repository/activation-analytics.repository';

/**
 * Fixed "now" = Wednesday 2024-06-12T12:00:00Z, with a data floor of 2024-05-01.
 * For the endpoint's defaults (range='all', weekly buckets) that yields the Monday
 * axis 2024-04-29 .. 2024-06-10, whose last bucket is the in-progress one.
 */
const FIXED_NOW = new Date('2024-06-12T12:00:00.000Z');
const DATA_FLOOR = new Date('2024-05-01T00:00:00.000Z');
const WEEKLY_AXIS = [
  '2024-04-29',
  '2024-05-06',
  '2024-05-13',
  '2024-05-20',
  '2024-05-27',
  '2024-06-03',
  '2024-06-10',
];

const emptySnapshot: ActivationSnapshotRow = {
  registeredLearners: 0,
  startedASim: 0,
  completedASim: 0,
  threePlusCompleted: 0,
  learnersByBand: TIME_TO_FIRST_PRACTICE_BANDS.map(() => 0),
  cumulativeActivated: TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS.map(() => 0),
};

describe('ActivationAnalyticsService', () => {
  let service: ActivationAnalyticsService;
  let repo: jest.Mocked<ActivationAnalyticsRepository>;

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(FIXED_NOW);

    const mockRepo: Partial<jest.Mocked<ActivationAnalyticsRepository>> = {
      getDataFloor: jest.fn().mockResolvedValue(DATA_FLOOR),
      getActivationSnapshot: jest.fn().mockResolvedValue(emptySnapshot),
      getPractisingLearnersByBucket: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivationAnalyticsService,
        { provide: ActivationAnalyticsRepository, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(ActivationAnalyticsService);
    repo = module.get(ActivationAnalyticsRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('window resolution', () => {
    it('defaults to all-time in weekly buckets, measuring the data floor', async () => {
      const res = await service.getActivation({});

      expect(repo.getDataFloor).toHaveBeenCalled();
      expect(res.window).toMatchObject({
        from: '2024-05-01',
        to: '2024-06-12',
        label: 'All time',
        bucket: 'week',
        allTime: true,
        inProgressBucket: '2024-06-10',
      });
      expect(res.practisingLearners.map((p) => p.bucket)).toEqual(WEEKLY_AXIS);
    });

    it('does not measure the data floor for a bounded range', async () => {
      const res = await service.getActivation({ range: '30d' });

      expect(repo.getDataFloor).not.toHaveBeenCalled();
      expect(res.window.bucket).toBe('week');
    });

    it('honours an explicit bucket over the endpoint default', async () => {
      await service.getActivation({ range: 'all', bucket: 'month' });

      expect(repo.getPractisingLearnersByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'month',
        undefined,
      );
    });
  });

  describe('practisingLearners', () => {
    it('gap-fills the axis with real zeros — a count of nobody is a measurement', async () => {
      repo.getPractisingLearnersByBucket.mockResolvedValue([
        { bucket: '2024-05-20', learners: 7, sessions: 19 },
      ]);

      const res = await service.getActivation({});

      expect(res.practisingLearners).toHaveLength(WEEKLY_AXIS.length);
      expect(res.practisingLearners).toContainEqual({
        bucket: '2024-05-20',
        learners: 7,
        sessions: 19,
      });
      expect(res.practisingLearners[0]).toEqual({
        bucket: '2024-04-29',
        learners: 0,
        sessions: 0,
      });
    });
  });

  describe('summary', () => {
    it('takes the latest COMPLETE bucket, never the in-progress one', async () => {
      repo.getPractisingLearnersByBucket.mockResolvedValue([
        { bucket: '2024-06-03', learners: 12, sessions: 30 },
        // The in-progress week: still accruing, so it can only rise.
        { bucket: '2024-06-10', learners: 2, sessions: 3 },
      ]);

      const res = await service.getActivation({});

      expect(res.summary.latestCompleteBucket).toBe('2024-06-03');
      expect(res.summary.latestPractisingLearners).toBe(12);
    });

    it('reports a complete bucket with no practice as zero, not null', async () => {
      const res = await service.getActivation({});

      expect(res.summary.latestCompleteBucket).toBe('2024-06-03');
      expect(res.summary.latestPractisingLearners).toBe(0);
    });

    it('reports null when the window contains no complete bucket at all', async () => {
      const res = await service.getActivation({
        from: '2024-06-12',
        to: '2024-06-12',
      });

      expect(res.window.inProgressBucket).toBe('2024-06-12');
      expect(res.summary.latestCompleteBucket).toBeNull();
      expect(res.summary.latestPractisingLearners).toBeNull();
    });

    it('suppresses the activation rate below the population floor', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: MIN_ACTIVATION_POPULATION - 1,
        startedASim: 2,
        completedASim: 1,
        learnersByBand: [1, 0, 0, 0, 0],
      });

      const res = await service.getActivation({});

      // The counts still travel; the share does not.
      expect(res.summary.registeredLearners).toBe(
        MIN_ACTIVATION_POPULATION - 1,
      );
      expect(res.summary.activatedLearners).toBe(1);
      expect(res.summary.activationRatePct).toBeNull();
      expect(res.summary.minPopulationSize).toBe(MIN_ACTIVATION_POPULATION);
    });

    it('states the activation rate once the population clears the floor', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 200,
        startedASim: 120,
        completedASim: 90,
        threePlusCompleted: 40,
      });

      const res = await service.getActivation({});

      expect(res.summary.activationRatePct).toBe(45);
    });
  });

  describe('funnel', () => {
    it('returns the four stages in order with the server-owned labels', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 100,
        startedASim: 70,
        completedASim: 55,
        threePlusCompleted: 20,
      });

      const res = await service.getActivation({});

      expect(res.funnel.denominatorLabel).toBe(
        ACTIVATION_FUNNEL_DENOMINATOR_LABEL,
      );
      expect(res.funnel.stages).toEqual([
        { key: 'signedUp', label: 'Signed up', reached: 100 },
        { key: 'startedASim', label: 'Started a simulation', reached: 70 },
        { key: 'completedASim', label: 'Completed one', reached: 55 },
        { key: 'threePlusCompleted', label: 'Completed 3+', reached: 20 },
      ]);
    });

    it('never widens as it descends, even on anomalous counts', async () => {
      // A data anomaly: more learners with completions than the population
      // counting them. A funnel that widens downward reads as a broken chart.
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 3,
        startedASim: 9,
        completedASim: 5,
        threePlusCompleted: 7,
      });

      const res = await service.getActivation({});

      const reached = res.funnel.stages.map((s) => s.reached);
      expect(reached).toEqual([9, 9, 5, 5]);
      // The population is widened to hold everyone counted inside it.
      expect(res.summary.registeredLearners).toBe(9);
    });
  });

  describe('timeToFirstPractice', () => {
    it('echoes the bands and the bound convention', async () => {
      const res = await service.getActivation({});

      expect(res.timeToFirstPractice.bands).toEqual(
        TIME_TO_FIRST_PRACTICE_BANDS,
      );
      expect(res.timeToFirstPractice.boundsNote).toBe(
        TIME_TO_FIRST_PRACTICE_BOUNDS_NOTE,
      );
    });

    it('derives the never-practised residual from the population', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 100,
        startedASim: 60,
        completedASim: 42,
        learnersByBand: [20, 10, 6, 4, 2],
      });

      const res = await service.getActivation({});

      expect(res.timeToFirstPractice.learnersByBand).toEqual([20, 10, 6, 4, 2]);
      expect(res.timeToFirstPractice.neverPractised).toBe(58);
    });

    it('clamps the residual at zero rather than inverting a bar', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 3,
        completedASim: 5,
        learnersByBand: [5, 0, 0, 0, 0],
      });

      const res = await service.getActivation({});

      expect(res.timeToFirstPractice.neverPractised).toBe(0);
    });

    it('returns the cumulative curve over the whole population, floor-suppressed', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 4,
        completedASim: 2,
        cumulativeActivated: TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS.map(
          () => 2,
        ),
      });

      const res = await service.getActivation({});

      expect(res.timeToFirstPractice.cumulative).toHaveLength(
        TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS.length,
      );
      // Counts survive below the floor; shares do not.
      expect(res.timeToFirstPractice.cumulative[0]).toEqual({
        days: TIME_TO_FIRST_PRACTICE_CUMULATIVE_DAYS[0],
        activated: 2,
        activatedPct: null,
      });
    });

    it('states cumulative shares of the whole population once above the floor', async () => {
      repo.getActivationSnapshot.mockResolvedValue({
        ...emptySnapshot,
        registeredLearners: 50,
        completedASim: 25,
        cumulativeActivated: [5, 10, 15, 20, 22, 24, 25, 25],
      });

      const res = await service.getActivation({});

      // 5/50 within a day, 25/50 by 90 days — a share of everyone, not of the
      // activated (which would reach 100% by construction).
      const curve = res.timeToFirstPractice.cumulative;
      expect(curve[0].activatedPct).toBe(10);
      expect(curve[curve.length - 1].activatedPct).toBe(50);
    });
  });

  describe('scoping', () => {
    it('passes a trimmed tenant filter through and echoes it', async () => {
      const res = await service.getActivation({ tenantId: '  ally  ' });

      expect(repo.getActivationSnapshot).toHaveBeenCalledWith('ally');
      expect(repo.getPractisingLearnersByBucket).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
        'week',
        'ally',
      );
      expect(res.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
    });

    it('treats a blank tenant filter as no filter', async () => {
      const res = await service.getActivation({ tenantId: '   ' });

      expect(repo.getActivationSnapshot).toHaveBeenCalledWith(undefined);
      expect(res.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });
  });
});
