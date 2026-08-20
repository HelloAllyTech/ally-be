import { Test, TestingModule } from '@nestjs/testing';

import { SkillGrowthAnalyticsService } from '../skill-growth-analytics.service';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  SKILL_GROWTH_DERIVATION,
  SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
  SKILL_GROWTH_LEARNER_SESSION_CAP,
  SKILL_GROWTH_MAX_ORDINAL,
  SKILL_GROWTH_PROVENANCE_NOTE,
  SKILL_TREND_FLAT_BAND,
  SKILL_TREND_MIN_SESSIONS,
  SKILL_TREND_WINDOW,
  SkillGrowthAnalyticsRepository,
  SkillGrowthDistribution,
  SkillGrowthLearnerSession,
  SkillGrowthOrdinalRow,
  SkillTrendMix,
} from '../../repository/skill-growth-analytics.repository';

/** A cell with `n` at or above the floor, so its score survives suppression. */
const thickCell = (median: number, n = MIN_SCORE_SAMPLE_SIZE) => ({
  median,
  p25: median - 8,
  p75: median + 8,
  n,
});

const ordinalRow = (
  ordinal: number,
  all: SkillGrowthOrdinalRow['all'],
  experienced: SkillGrowthOrdinalRow['experienced'] = all,
): SkillGrowthOrdinalRow => ({ ordinal, all, experienced });

const emptyDistribution: SkillGrowthDistribution = {
  ordinals: [],
  learners: 0,
  experiencedLearners: 0,
  evaluatedSessions: 0,
};

const emptyTrendMix: SkillTrendMix = {
  classifiedLearners: 0,
  insufficientLearners: 0,
  improving: 0,
  flat: 0,
  declining: 0,
  months: [],
};

/** A learner session with only the fields classification reads. */
const sessionAt = (ordinal: number, compositeScore: number) => ({
  ordinal,
  occurredAt: `2026-0${Math.min(ordinal, 9)}-01T00:00:00.000Z`,
  scenarioTitle: 'De-escalation basics',
  compositeScore,
  skillCoverage: null,
});

describe('SkillGrowthAnalyticsService', () => {
  let service: SkillGrowthAnalyticsService;
  let repository: jest.Mocked<SkillGrowthAnalyticsRepository>;

  const setup = async (
    distribution: SkillGrowthDistribution = emptyDistribution,
    trendMix: SkillTrendMix = emptyTrendMix,
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillGrowthAnalyticsService,
        {
          provide: SkillGrowthAnalyticsRepository,
          useValue: {
            getOrdinalDistribution: jest.fn().mockResolvedValue(distribution),
            getTrendMix: jest.fn().mockResolvedValue(trendMix),
            getLearnerTrendPage: jest
              .fn()
              .mockResolvedValue({ rows: [], total: 0 }),
            getLearnerIdentity: jest.fn().mockResolvedValue(null),
            getLearnerSessions: jest.fn().mockResolvedValue([]),
            getLearnerKnowledgeAttempts: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get(SkillGrowthAnalyticsService);
    repository = module.get(SkillGrowthAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('echoes the axis bounds, the floors and the provenance caveat', async () => {
    await setup();

    const result = await service.getSkillGrowth({});

    expect(result.maxOrdinal).toBe(SKILL_GROWTH_MAX_ORDINAL);
    expect(result.experiencedMinSessions).toBe(
      SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
    );
    expect(result.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(result.scoreDomain).toEqual([0, 100]);
    expect(result.provenance).toEqual({
      derivation: SKILL_GROWTH_DERIVATION,
      note: SKILL_GROWTH_PROVENANCE_NOTE,
    });
    // The caveat has to name the missing control, or the chart implies one.
    expect(result.provenance.note).toMatch(/does NOT pin a judge version/);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
  });

  it('completes the ordinal axis to maxOrdinal without inventing measurements', async () => {
    await setup({
      ...emptyDistribution,
      ordinals: [ordinalRow(1, thickCell(60)), ordinalRow(2, thickCell(64))],
      learners: 40,
      evaluatedSessions: 60,
    });

    const result = await service.getSkillGrowth({});

    expect(result.ordinals).toHaveLength(SKILL_GROWTH_MAX_ORDINAL);
    expect(result.ordinals.map((o) => o.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // An ordinal nobody reached: the tick exists (n is a real zero), the score
    // does not (a median of no observations is not a median of zero).
    const untouched = result.ordinals[5];
    expect(untouched.all).toEqual({ median: null, p25: null, p75: null, n: 0 });
    expect(untouched.experienced.n).toBe(0);
  });

  it('suppresses a below-floor cell but keeps its n so the panel can explain itself', async () => {
    await setup({
      ...emptyDistribution,
      ordinals: [
        ordinalRow(1, thickCell(58, 120)),
        // 4 sessions: nowhere near enough to state a median from.
        ordinalRow(2, thickCell(91, 4)),
      ],
      learners: 120,
      evaluatedSessions: 124,
    });

    const result = await service.getSkillGrowth({});

    const thin = result.ordinals[1];
    expect(thin.all.median).toBeNull();
    expect(thin.all.p25).toBeNull();
    expect(thin.all.p75).toBeNull();
    // The count survives — this is what turns a blank cell into a stated limit.
    expect(thin.all.n).toBe(4);
  });

  it('suppresses the two variants independently, from the same rows', async () => {
    // The "all" cell clears the floor; the experienced subset of the SAME rows
    // does not. Both must be judged on their own n.
    await setup({
      ...emptyDistribution,
      ordinals: [
        ordinalRow(1, thickCell(61, 80), thickCell(66, MIN_SCORE_SAMPLE_SIZE)),
        ordinalRow(2, thickCell(65, 50), thickCell(71, 9)),
      ],
      learners: 80,
      experiencedLearners: 9,
      evaluatedSessions: 130,
    });

    const result = await service.getSkillGrowth({});

    expect(result.ordinals[0].experienced.median).toBe(66);
    expect(result.ordinals[1].all.median).toBe(65);
    expect(result.ordinals[1].experienced.median).toBeNull();
    expect(result.ordinals[1].experienced.n).toBe(9);
  });

  it('reads the headline off the last ordinal that clears the floor', async () => {
    await setup({
      ...emptyDistribution,
      ordinals: [
        ordinalRow(1, thickCell(55, 300)),
        ordinalRow(2, thickCell(62, 180)),
        ordinalRow(3, thickCell(69, 40)),
        // Below the floor: must not become the headline even though it is the
        // most flattering point on the chart.
        ordinalRow(4, thickCell(97, 6)),
      ],
      learners: 300,
      experiencedLearners: 25,
      evaluatedSessions: 526,
    });

    const result = await service.getSkillGrowth({});

    expect(result.summary.firstOrdinalMedian).toBe(55);
    expect(result.summary.lastComparableOrdinal).toBe(3);
    expect(result.summary.lastComparableMedian).toBe(69);
    expect(result.summary.learners).toBe(300);
    expect(result.summary.experiencedLearners).toBe(25);
    expect(result.summary.evaluatedSessions).toBe(526);
  });

  it('returns a null headline when even the first ordinal is below the floor', async () => {
    await setup({
      ...emptyDistribution,
      ordinals: [ordinalRow(1, thickCell(72, 3))],
      learners: 3,
      evaluatedSessions: 3,
    });

    const result = await service.getSkillGrowth({});

    expect(result.summary.firstOrdinalMedian).toBeNull();
    expect(result.summary.lastComparableOrdinal).toBeNull();
    expect(result.summary.lastComparableMedian).toBeNull();
  });

  it('passes a trimmed tenant filter through and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getSkillGrowth({ tenantId: '  ally  ' });

    expect(repository.getOrdinalDistribution).toHaveBeenCalledWith('ally');
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });

  it('treats a blank tenant filter as no filter', async () => {
    await setup();

    await service.getSkillGrowth({ tenantId: '   ' });

    expect(repository.getOrdinalDistribution).toHaveBeenCalledWith(undefined);
    expect(repository.getTrendMix).toHaveBeenCalledWith(undefined);
  });

  it('attaches the trend mix with the thresholds it was classified under', async () => {
    await setup(emptyDistribution, {
      classifiedLearners: 10,
      insufficientLearners: 30,
      improving: 6,
      flat: 3,
      declining: 1,
      months: [{ month: '2026-07', improving: 6, flat: 3, declining: 1 }],
    });

    const result = await service.getSkillGrowth({});

    expect(result.trendMix.improving).toBe(6);
    expect(result.trendMix.insufficientLearners).toBe(30);
    expect(result.trendMix.months).toHaveLength(1);
    // The knobs travel with the numbers, so no client re-invents them.
    expect(result.trendMix.thresholds).toEqual({
      minSessions: SKILL_TREND_MIN_SESSIONS,
      window: SKILL_TREND_WINDOW,
      flatBand: SKILL_TREND_FLAT_BAND,
    });
  });

  describe('getLearnerTrends', () => {
    it('defaults to the biggest movers first and echoes the page shape', async () => {
      await setup();

      const result = await service.getLearnerTrends({});

      expect(repository.getLearnerTrendPage).toHaveBeenCalledWith({
        tenantId: undefined,
        limit: 20,
        offset: 0,
        sort: 'delta',
        descending: true,
      });
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.thresholds.minSessions).toBe(SKILL_TREND_MIN_SESSIONS);
      expect(result.provenance.note).toBe(SKILL_GROWTH_PROVENANCE_NOTE);
    });

    it('passes paging, sort and tenant through untranslated', async () => {
      await setup();

      await service.getLearnerTrends({
        tenantId: ' ally ',
        limit: 50,
        offset: 100,
        sort: 'lastSessionAt',
        order: 'asc',
      });

      expect(repository.getLearnerTrendPage).toHaveBeenCalledWith({
        tenantId: 'ally',
        limit: 50,
        offset: 100,
        sort: 'lastSessionAt',
        descending: false,
      });
    });
  });

  describe('getLearnerSeries', () => {
    const identity = {
      id: 7,
      name: 'Asha',
      email: 'asha@example.com',
      tenantId: 'ally',
    };

    it('404s on an unknown user id', async () => {
      await setup();

      await expect(service.getLearnerSeries(999)).rejects.toThrow(
        'No user with id 999',
      );
    });

    it('returns empty series for a learner with no evaluated sessions', async () => {
      await setup();
      repository.getLearnerIdentity.mockResolvedValue(identity);

      const result = await service.getLearnerSeries(7);

      expect(result.sessions).toEqual([]);
      expect(result.knowledgeAttempts).toEqual([]);
      expect(result.learner.trend).toBe('insufficient');
      expect(result.learner.delta).toBeNull();
      expect(result.truncated).toBe(false);
    });

    it('classifies the learner from the same windows the list uses', async () => {
      await setup();
      repository.getLearnerIdentity.mockResolvedValue(identity);
      // First window mean (40+50)/2 = 45; last window (70+80)/2 = 75; +30.
      repository.getLearnerSessions.mockResolvedValue([
        sessionAt(1, 40),
        sessionAt(2, 50),
        sessionAt(3, 60),
        sessionAt(4, 70),
        sessionAt(5, 80),
      ]);

      const result = await service.getLearnerSeries(7);

      expect(result.learner.evaluatedSessions).toBe(5);
      expect(result.learner.firstWindowMean).toBe(45);
      expect(result.learner.lastWindowMean).toBe(75);
      expect(result.learner.delta).toBe(30);
      expect(result.learner.trend).toBe('improving');
    });

    it('reports a delta inside the flat band as flat, not movement', async () => {
      await setup();
      repository.getLearnerIdentity.mockResolvedValue(identity);
      repository.getLearnerSessions.mockResolvedValue([
        sessionAt(1, 60),
        sessionAt(2, 60),
        sessionAt(3, 60),
        sessionAt(4, 60 + SKILL_TREND_FLAT_BAND), // +2.5 mean shift: inside the band
      ]);

      const result = await service.getLearnerSeries(7);

      expect(result.learner.trend).toBe('flat');
    });

    it('flags a capped series as truncated instead of passing it off as complete', async () => {
      await setup();
      repository.getLearnerIdentity.mockResolvedValue(identity);
      const capped: SkillGrowthLearnerSession[] = Array.from(
        { length: SKILL_GROWTH_LEARNER_SESSION_CAP },
        (_, i) => sessionAt(i + 1, 50),
      );
      repository.getLearnerSessions.mockResolvedValue(capped);

      const result = await service.getLearnerSeries(7);

      expect(result.truncated).toBe(true);
    });
  });
});
