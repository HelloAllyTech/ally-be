import { Test, TestingModule } from '@nestjs/testing';

import { CompetencyMapAnalyticsService } from '../competency-map-analytics.service';
import {
  CompetencyMapAnalyticsRepository,
  CompetencyMapResult,
  UNATTRIBUTED_COMPETENCY_LABEL,
} from '../../repository/competency-map-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';

const emptyResult: CompetencyMapResult = {
  rows: [],
  unattributed: { completedSessions: 0, evaluatedSessions: 0 },
  totals: { completedSessions: 0, evaluatedSessions: 0 },
};

describe('CompetencyMapAnalyticsService', () => {
  let service: CompetencyMapAnalyticsService;
  let repository: jest.Mocked<CompetencyMapAnalyticsRepository>;

  const setup = async (result: CompetencyMapResult = emptyResult) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetencyMapAnalyticsService,
        {
          provide: CompetencyMapAnalyticsRepository,
          useValue: {
            getCompetencyMap: jest.fn().mockResolvedValue(result),
          },
        },
      ],
    }).compile();

    service = module.get(CompetencyMapAnalyticsService);
    repository = module.get(CompetencyMapAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('echoes the score floor, the axis domain and the scoping', async () => {
    await setup();

    const result = await service.getCompetencyMap({});

    expect(result.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(result.scoreDomain).toEqual([0, 100]);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    expect(result.unattributed.label).toBe(UNATTRIBUTED_COMPETENCY_LABEL);
  });

  it('keeps a below-floor row and suppresses only its score', async () => {
    await setup({
      rows: [
        {
          competencyId: 'c-1',
          name: 'Empathy',
          completedSessions: 400,
          evaluatedSessions: 300,
          medianScore: 64,
          learners: 90,
          scenarios: 12,
        },
        {
          // Heavily practised, barely judged: exactly the finding the map
          // exists to surface, so the row must not be dropped with its score.
          competencyId: 'c-2',
          name: 'Boundary setting',
          completedSessions: 220,
          evaluatedSessions: MIN_SCORE_SAMPLE_SIZE - 1,
          medianScore: 91,
          learners: 40,
          scenarios: 5,
        },
      ],
      unattributed: { completedSessions: 0, evaluatedSessions: 0 },
      totals: { completedSessions: 500, evaluatedSessions: 319 },
    });

    const result = await service.getCompetencyMap({});

    expect(result.competencies[0].medianScore).toBe(64);
    expect(result.competencies[0].belowFloor).toBe(false);

    const thin = result.competencies[1];
    expect(thin.medianScore).toBeNull();
    expect(thin.belowFloor).toBe(true);
    // Volume and coverage survive the suppression.
    expect(thin.completedSessions).toBe(220);
    expect(thin.evaluatedSessions).toBe(MIN_SCORE_SAMPLE_SIZE - 1);
    expect(thin.learners).toBe(40);
    expect(thin.scenarios).toBe(5);
  });

  it('lets the per-competency counts exceed the session total (multi-competency)', async () => {
    // 60 sessions on scenarios tagged with BOTH competencies: each row counts
    // them, so 60 + 60 > 60. Declared behaviour, not a rounding accident.
    await setup({
      rows: [
        {
          competencyId: 'c-1',
          name: 'Empathy',
          completedSessions: 60,
          evaluatedSessions: 60,
          medianScore: 70,
          learners: 20,
          scenarios: 3,
        },
        {
          competencyId: 'c-2',
          name: 'Boundary setting',
          completedSessions: 60,
          evaluatedSessions: 60,
          medianScore: 55,
          learners: 20,
          scenarios: 3,
        },
      ],
      unattributed: { completedSessions: 0, evaluatedSessions: 0 },
      totals: { completedSessions: 60, evaluatedSessions: 60 },
    });

    const result = await service.getCompetencyMap({});

    const summed = result.competencies.reduce(
      (n, c) => n + c.completedSessions,
      0,
    );
    expect(summed).toBe(120);
    // The summary counts DISTINCT sessions — it is not the sum of the rows.
    expect(result.summary.completedSessions).toBe(60);
    expect(result.summary.evaluatedSessions).toBe(60);
    expect(result.summary.competencies).toBe(2);
  });

  it('reports untagged practice as its own labelled slice', async () => {
    await setup({
      rows: [
        {
          competencyId: 'c-1',
          name: 'Empathy',
          completedSessions: 100,
          evaluatedSessions: 90,
          medianScore: 68,
          learners: 30,
          scenarios: 4,
        },
      ],
      unattributed: { completedSessions: 45, evaluatedSessions: 30 },
      totals: { completedSessions: 145, evaluatedSessions: 120 },
    });

    const result = await service.getCompetencyMap({});

    expect(result.unattributed).toEqual({
      completedSessions: 45,
      evaluatedSessions: 30,
      label: UNATTRIBUTED_COMPETENCY_LABEL,
    });
    // The map covers 100 of 145 completed sessions, and says so.
    expect(result.summary.completedSessions).toBe(145);
  });

  it('preserves the repository ordering (volume desc)', async () => {
    await setup({
      ...emptyResult,
      rows: [
        {
          competencyId: 'c-1',
          name: 'Busy',
          completedSessions: 300,
          evaluatedSessions: 40,
          medianScore: 50,
          learners: 60,
          scenarios: 8,
        },
        {
          competencyId: 'c-2',
          name: 'Quiet',
          completedSessions: 30,
          evaluatedSessions: 25,
          medianScore: 80,
          learners: 9,
          scenarios: 2,
        },
      ],
    });

    const result = await service.getCompetencyMap({});

    expect(result.competencies.map((c) => c.name)).toEqual(['Busy', 'Quiet']);
  });

  it('passes a trimmed tenant filter through and echoes it in the scoping', async () => {
    await setup();

    const result = await service.getCompetencyMap({ tenantId: '  ally  ' });

    expect(repository.getCompetencyMap).toHaveBeenCalledWith('ally');
    expect(result.scoping).toEqual({ tenantId: 'ally', unscopedSections: [] });
  });

  it('treats a blank tenant filter as no filter', async () => {
    await setup();

    await service.getCompetencyMap({ tenantId: '   ' });

    expect(repository.getCompetencyMap).toHaveBeenCalledWith(undefined);
  });
});
