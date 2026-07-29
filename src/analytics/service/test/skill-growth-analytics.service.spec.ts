import { Test, TestingModule } from '@nestjs/testing';

import { SkillGrowthAnalyticsService } from '../skill-growth-analytics.service';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import {
  SKILL_GROWTH_DERIVATION,
  SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
  SKILL_GROWTH_MAX_ORDINAL,
  SKILL_GROWTH_PROVENANCE_NOTE,
  SkillGrowthAnalyticsRepository,
  SkillGrowthDistribution,
  SkillGrowthOrdinalRow,
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

describe('SkillGrowthAnalyticsService', () => {
  let service: SkillGrowthAnalyticsService;
  let repository: jest.Mocked<SkillGrowthAnalyticsRepository>;

  const setup = async (
    distribution: SkillGrowthDistribution = emptyDistribution,
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillGrowthAnalyticsService,
        {
          provide: SkillGrowthAnalyticsRepository,
          useValue: {
            getOrdinalDistribution: jest.fn().mockResolvedValue(distribution),
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
  });
});
