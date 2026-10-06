import { Test, TestingModule } from '@nestjs/testing';

import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  COMPETENCY_MAP_PROVENANCE_NOTE,
  CompetencyMapAnalyticsService,
} from '../competency-map-analytics.service';
import {
  CompetencyMapAnalyticsRepository,
  CompetencyMapResult,
  UNATTRIBUTED_COMPETENCY_LABEL,
} from '../../repository/competency-map-analytics.repository';
import {
  FoundationalSkillsAnalyticsRepository,
  FoundationalSkillsLearnerCutRow,
} from '../../repository/foundational-skills-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';

const EMPATHY = 'c-empathy';
const NON_VERBAL = 'c-nonverbal';

const emptyResult: CompetencyMapResult = {
  rows: [],
  unattributed: { completedSessions: 0 },
  totals: { completedSessions: 0 },
};

const volume: CompetencyMapResult = {
  rows: [
    {
      competencyId: EMPATHY,
      name: 'Empathy, Warmth & Genuineness',
      completedSessions: 400,
      learners: 90,
      scenarios: 12,
    },
    {
      competencyId: NON_VERBAL,
      name: 'Non-Verbal Communication',
      completedSessions: 220,
      learners: 40,
      scenarios: 5,
    },
  ],
  unattributed: { completedSessions: 45 },
  totals: { completedSessions: 500 },
};

const cut = (
  userId: number,
  sessionIds: string[],
  levels: Record<string, number>,
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: null,
  tenantId: 'org-a',
  cut: 1,
  closedAt: new Date('2026-08-01T00:00:00Z'),
  score: 2.5,
  unhelpful: false,
  levels,
  verdicts: [],
  sessionIds,
});

/** Enough single-scenario empathy cuts on scenario 1 to clear the floor. */
const thickCuts = (): FoundationalSkillsLearnerCutRow[] => [
  ...Array.from({ length: MIN_SCORE_SAMPLE_SIZE }, (_, i) =>
    cut(i + 1, ['s1'], { empathy: i % 2 === 0 ? 3 : 2 }),
  ),
  // Spans two scenarios: never credited.
  cut(99, ['s1', 's2'], { empathy: 1 }),
  // Untagged scenario.
  cut(98, ['s9'], { empathy: 1 }),
];

describe('CompetencyMapAnalyticsService', () => {
  let service: CompetencyMapAnalyticsService;
  let repository: jest.Mocked<CompetencyMapAnalyticsRepository>;
  let cuts: jest.Mocked<FoundationalSkillsAnalyticsRepository>;

  const setup = async (
    result: CompetencyMapResult = emptyResult,
    cutRows: FoundationalSkillsLearnerCutRow[] = [],
  ) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetencyMapAnalyticsService,
        {
          provide: CompetencyMapAnalyticsRepository,
          useValue: {
            getCompetencyMap: jest.fn().mockResolvedValue(result),
            getScenarioCompetencyTags: jest
              .fn()
              .mockResolvedValue(new Map([[1, [EMPATHY, NON_VERBAL]]])),
          },
        },
        {
          provide: FoundationalSkillsAnalyticsRepository,
          useValue: {
            getAllLearnerCuts: jest.fn().mockResolvedValue(cutRows),
            getSessionScenarios: jest.fn().mockResolvedValue(
              new Map([
                ['s1', { scenarioId: 1, scenarioTitle: 'Grief' }],
                ['s2', { scenarioId: 2, scenarioTitle: 'Exam stress' }],
                ['s9', { scenarioId: 9, scenarioTitle: 'Untagged' }],
              ]),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(CompetencyMapAnalyticsService);
    repository = module.get(CompetencyMapAnalyticsRepository);
    cuts = module.get(FoundationalSkillsAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  it('echoes the floor, the 1–4 axis, the rubric, the scoping and the provenance', async () => {
    await setup();

    const result = await service.getCompetencyMap({});

    expect(result.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
    expect(result.scoreDomain).toEqual([1, 4]);
    expect(result.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    expect(result.unattributed.label).toBe(UNATTRIBUTED_COMPETENCY_LABEL);
    expect(result.provenance.note).toBe(COMPETENCY_MAP_PROVENANCE_NOTE);
    expect(result.provenance.note).toMatch(/Until October 2026/);
    expect(result.provenance.derivation).toMatch(/R1/);
    expect(result.cutAttribution).toEqual({
      scoredCuts: 0,
      singleScenarioCuts: 0,
      singleScenarioPct: null,
      untaggedCuts: 0,
    });
  });

  it('reads the pinned learner ruler, scoped like the volume axis', async () => {
    await setup();

    await service.getCompetencyMap({ tenantId: '  ally  ' });

    expect(repository.getCompetencyMap).toHaveBeenCalledWith('ally');
    expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
      FHS_RUBRIC_VERSION,
      'ally',
    );

    await service.getCompetencyMap({ tenantId: '   ' });
    expect(repository.getCompetencyMap).toHaveBeenLastCalledWith(undefined);
    expect(cuts.getAllLearnerCuts).toHaveBeenLastCalledWith(
      FHS_RUBRIC_VERSION,
      undefined,
    );
  });

  it('asks for tags only for scenarios a single-scenario cut ran', async () => {
    await setup(volume, thickCuts());

    await service.getCompetencyMap({});

    expect(cuts.getSessionScenarios).toHaveBeenCalledWith(['s1', 's2', 's9']);
    expect(repository.getScenarioCompetencyTags).toHaveBeenCalledWith([1, 9]);
  });

  it('scores a mapped tag on its own skill and keeps the released-client aliases in step', async () => {
    await setup(volume, thickCuts());

    const result = await service.getCompetencyMap({});
    const empathy = result.competencies[0];

    expect(empathy).toMatchObject({
      competencyId: EMPATHY,
      completedSessions: 400,
      learners: 90,
      scenarios: 12,
      skill: 'empathy',
      score: 2.5,
      taggedCuts: MIN_SCORE_SAMPLE_SIZE,
      scoredCuts: MIN_SCORE_SAMPLE_SIZE,
      scoreLearners: MIN_SCORE_SAMPLE_SIZE,
      scoreUnavailable: null,
      medianScore: 2.5,
      evaluatedSessions: MIN_SCORE_SAMPLE_SIZE,
      belowFloor: false,
    });
  });

  it('gives a tag with no rubric skill its volume and a reason, never belowFloor', async () => {
    await setup(volume, thickCuts());

    const result = await service.getCompetencyMap({});
    const nonVerbal = result.competencies[1];

    expect(nonVerbal).toMatchObject({
      completedSessions: 220,
      skill: null,
      score: null,
      medianScore: null,
      scoreUnavailable: 'noRubricSkill',
      belowFloor: false,
    });
  });

  it('withholds a thin score with tooFewCuts and belowFloor, counts kept', async () => {
    await setup(volume, thickCuts().slice(1));

    const result = await service.getCompetencyMap({});
    const empathy = result.competencies[0];

    expect(empathy).toMatchObject({
      score: null,
      medianScore: null,
      scoreUnavailable: 'tooFewCuts',
      belowFloor: true,
      scoredCuts: MIN_SCORE_SAMPLE_SIZE - 1,
      evaluatedSessions: MIN_SCORE_SAMPLE_SIZE - 1,
    });
  });

  it('reports the single-scenario share and the untagged cuts', async () => {
    await setup(volume, thickCuts());

    const result = await service.getCompetencyMap({});

    expect(result.cutAttribution).toEqual({
      scoredCuts: MIN_SCORE_SAMPLE_SIZE + 2,
      singleScenarioCuts: MIN_SCORE_SAMPLE_SIZE + 1,
      singleScenarioPct:
        Math.round(
          ((MIN_SCORE_SAMPLE_SIZE + 1) / (MIN_SCORE_SAMPLE_SIZE + 2)) * 1000,
        ) / 10,
      untaggedCuts: 1,
    });
    expect(result.unattributed).toEqual({
      completedSessions: 45,
      scoredCuts: 1,
      evaluatedSessions: 1,
      label: UNATTRIBUTED_COMPETENCY_LABEL,
    });
    // DISTINCT sessions, not the sum of the rows (multi-competency tagging).
    expect(result.summary).toEqual({
      competencies: 2,
      completedSessions: 500,
      evaluatedSessions: MIN_SCORE_SAMPLE_SIZE + 1,
    });
  });

  it('preserves the repository ordering (volume desc)', async () => {
    await setup(volume);

    const result = await service.getCompetencyMap({});

    expect(result.competencies.map((c) => c.competencyId)).toEqual([
      EMPATHY,
      NON_VERBAL,
    ]);
  });
});
