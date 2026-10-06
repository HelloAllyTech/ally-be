import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { FHS_RUBRIC_VERSION } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  SKILL_GROWTH_DERIVATION,
  SKILL_GROWTH_PROVENANCE_NOTE,
  SkillGrowthAnalyticsService,
} from '../skill-growth-analytics.service';
import {
  FoundationalSkillsAnalyticsRepository,
  FoundationalSkillsLearnerCutRow,
} from '../../repository/foundational-skills-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../../repository/quality-distribution-analytics.repository';
import { SkillGrowthAnalyticsRepository } from '../../repository/skill-growth-analytics.repository';
import {
  FHS_PROGRESS_THRESHOLDS,
  cutNoiseSd,
} from '../../util/foundational-skills-progress.util';
import {
  SKILL_GROWTH_EXPERIENCED_MIN_CUTS,
  SKILL_GROWTH_LEARNER_ROW_CAP,
  SKILL_GROWTH_MAX_ORDINAL,
  classifySkillGrowthLearner,
  toSkillGrowthLearners,
} from '../../util/skill-growth.util';

const row = (
  userId: number,
  cut: number,
  score: number,
  extra: Partial<FoundationalSkillsLearnerCutRow> = {},
): FoundationalSkillsLearnerCutRow => ({
  userId,
  name: `Learner ${userId}`,
  tenantId: 'org-a',
  cut,
  closedAt: new Date(Date.UTC(2026, 7, cut, 9)),
  score,
  unhelpful: false,
  levels: { empathy: 2 },
  verdicts: [],
  sessionIds: [`s-${userId}-${cut}`],
  ...extra,
});

/** `MIN_SCORE_SAMPLE_SIZE` learners with three cuts, so ordinals 1–3 clear the floor. */
const thickPopulation = (): FoundationalSkillsLearnerCutRow[] =>
  Array.from({ length: MIN_SCORE_SAMPLE_SIZE }, (_, i) => i + 1).flatMap(
    (u) => [row(u, 1, 2), row(u, 2, 2.25), row(u, 3, 2.5)],
  );

describe('SkillGrowthAnalyticsService', () => {
  let service: SkillGrowthAnalyticsService;
  let repository: jest.Mocked<SkillGrowthAnalyticsRepository>;
  let cuts: jest.Mocked<FoundationalSkillsAnalyticsRepository>;

  const setup = async (rows: FoundationalSkillsLearnerCutRow[] = []) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillGrowthAnalyticsService,
        {
          provide: SkillGrowthAnalyticsRepository,
          useValue: {
            getLearnerIdentity: jest.fn().mockResolvedValue(null),
            getLearnerIdentities: jest.fn().mockResolvedValue([]),
            getLearnerKnowledgeAttempts: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: FoundationalSkillsAnalyticsRepository,
          useValue: {
            getAllLearnerCuts: jest.fn().mockResolvedValue(rows),
            getSessionScenarios: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    service = module.get(SkillGrowthAnalyticsService);
    repository = module.get(SkillGrowthAnalyticsRepository);
    cuts = module.get(FoundationalSkillsAnalyticsRepository);
  };

  afterEach(() => jest.clearAllMocks());

  describe('getSkillGrowth', () => {
    it('reads the pinned learner ruler and says so on the card', async () => {
      await setup();

      const result = await service.getSkillGrowth({});

      expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
        FHS_RUBRIC_VERSION,
        undefined,
      );
      expect(result.scoreDomain).toEqual([1, 4]);
      expect(result.rubricVersion).toBe(FHS_RUBRIC_VERSION);
      expect(result.cutSizeLearnerChars).toBe(5000);
      expect(result.maxOrdinal).toBe(SKILL_GROWTH_MAX_ORDINAL);
      expect(result.experiencedMinSessions).toBe(
        SKILL_GROWTH_EXPERIENCED_MIN_CUTS,
      );
      expect(result.minSampleSize).toBe(MIN_SCORE_SAMPLE_SIZE);
      expect(result.provenance).toEqual({
        derivation: SKILL_GROWTH_DERIVATION,
        note: SKILL_GROWTH_PROVENANCE_NOTE,
      });
      expect(result.provenance.derivation).toMatch(/OWN speech/);
      expect(result.provenance.derivation).toMatch(/5,000-character/);
      expect(result.provenance.note).toMatch(/human raters/);
      expect(result.provenance.note).toContain(FHS_RUBRIC_VERSION);
      // Anyone comparing screenshots has to be told the series changed.
      expect(result.provenance.note).toMatch(/Until October 2026/);
      expect(result.provenance.note).toMatch(/AI roleplay character/);
      expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });

    it('passes a trimmed tenant through to the cut read, and a blank one as none', async () => {
      await setup();

      const scoped = await service.getSkillGrowth({ tenantId: '  ally  ' });
      expect(cuts.getAllLearnerCuts).toHaveBeenLastCalledWith(
        FHS_RUBRIC_VERSION,
        'ally',
      );
      expect(scoped.scoping).toEqual({
        tenantId: 'ally',
        unscopedSections: [],
      });

      await service.getSkillGrowth({ tenantId: '   ' });
      expect(cuts.getAllLearnerCuts).toHaveBeenLastCalledWith(
        FHS_RUBRIC_VERSION,
        undefined,
      );
    });

    it('draws the curve by cut index with the floor applied and n kept', async () => {
      // A 21st learner reaches cut 4 alone: the tick is there, the median is not.
      await setup([...thickPopulation(), row(99, 4, 3.5)]);

      const result = await service.getSkillGrowth({});

      expect(result.ordinals).toHaveLength(SKILL_GROWTH_MAX_ORDINAL);
      expect(result.ordinals[0].all).toEqual({
        median: 2,
        p25: 2,
        p75: 2,
        n: MIN_SCORE_SAMPLE_SIZE,
      });
      expect(result.ordinals[2].all.median).toBe(2.5);
      expect(result.ordinals[3].all).toEqual({
        median: null,
        p25: null,
        p75: null,
        n: 1,
      });
      expect(result.summary).toEqual({
        learners: MIN_SCORE_SAMPLE_SIZE + 1,
        experiencedLearners: 0,
        evaluatedSessions: MIN_SCORE_SAMPLE_SIZE * 3 + 1,
        firstOrdinalMedian: 2,
        lastComparableOrdinal: 3,
        lastComparableMedian: 2.5,
      });
    });

    it('classifies the trend mix with the noise of the population in scope', async () => {
      const rows = [
        ...[2, 2, 3, 3].map((s, i) => row(1, i + 1, s)),
        ...[3, 3, 2, 2].map((s, i) => row(2, i + 1, s)),
        ...[2.4, 2.5, 2.5, 2.4].map((s, i) => row(3, i + 1, s)),
        row(4, 1, 2),
      ];
      await setup(rows);

      const result = await service.getSkillGrowth({});
      const noise = cutNoiseSd(toSkillGrowthLearners(rows));

      expect(result.trendMix.thresholds.cutNoiseSd).toBe(
        Math.round((noise as number) * 1000) / 1000,
      );
      expect(result.trendMix.thresholds.minSessions).toBe(
        FHS_PROGRESS_THRESHOLDS.trendMinCuts,
      );
      const expected = toSkillGrowthLearners(rows).map(
        (l) => classifySkillGrowthLearner(l, noise).trend,
      );
      const count = (t: string) => expected.filter((x) => x === t).length;
      expect(result.trendMix.improving).toBe(count('improving'));
      expect(result.trendMix.flat).toBe(count('flat'));
      expect(result.trendMix.declining).toBe(count('declining'));
      expect(result.trendMix.insufficientLearners).toBe(count('insufficient'));
      expect(result.trendMix.insufficientLearners).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getLearnerTrends', () => {
    const rows = [
      ...[2, 2, 3, 3].map((s, i) => row(1, i + 1, s)),
      ...[3, 3, 2, 2].map((s, i) => row(2, i + 1, s)),
      row(3, 1, 2),
      row(3, 2, 2.1),
    ];

    it('sorts by own change, pages in memory, and looks up only the page', async () => {
      await setup(rows);
      repository.getLearnerIdentities.mockResolvedValue([
        { id: 1, name: 'Asha', email: 'asha@example.com', tenantId: 'org-a' },
      ]);

      const result = await service.getLearnerTrends({ limit: 1 });

      expect(result.total).toBe(3);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        learnerId: 1,
        name: 'Asha',
        email: 'asha@example.com',
        tenantId: 'org-a',
        evaluatedSessions: 4,
        firstWindowMean: 2,
        lastWindowMean: 3,
        delta: 1,
      });
      expect(result.rows[0].band).not.toBeNull();
      expect(result.rows[0].lastSessionAt).toBe(rows[3].closedAt.toISOString());
      expect(repository.getLearnerIdentities).toHaveBeenCalledWith([1]);
      expect(result.rubricVersion).toBe(FHS_RUBRIC_VERSION);
      expect(result.scoping).toEqual({ tenantId: null, unscopedSections: [] });
    });

    it('lists unclassified learners last with null means', async () => {
      await setup(rows);

      const result = await service.getLearnerTrends({});
      const last = result.rows[result.rows.length - 1];

      expect(result.rows.map((r) => r.learnerId)).toEqual([1, 2, 3]);
      expect(last).toMatchObject({
        learnerId: 3,
        trend: 'insufficient',
        firstWindowMean: null,
        delta: null,
        band: null,
        email: null,
        // No users row: falls back to the cut's name and tenant.
        name: 'Learner 3',
        tenantId: 'org-a',
      });
    });

    it('passes the tenant to the cut read and sorts ascending on request', async () => {
      await setup(rows);

      const result = await service.getLearnerTrends({
        tenantId: ' ally ',
        sort: 'delta',
        order: 'asc',
      });

      expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
        FHS_RUBRIC_VERSION,
        'ally',
      );
      expect(result.rows.map((r) => r.learnerId)).toEqual([2, 1, 3]);
      expect(result.scoping.tenantId).toBe('ally');
    });
  });

  describe('getLearnerSeries', () => {
    const identity = {
      id: 7,
      name: 'Asha',
      email: 'asha@example.com',
      tenantId: 'org-a',
    };

    it('404s on an unknown user id', async () => {
      await setup();

      await expect(service.getLearnerSeries(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns empty series for a learner with no scored cuts', async () => {
      await setup([row(1, 1, 2)]);
      repository.getLearnerIdentity.mockResolvedValue(identity);

      const result = await service.getLearnerSeries(7);

      expect(result.sessions).toEqual([]);
      expect(result.learner).toMatchObject({
        id: 7,
        evaluatedSessions: 0,
        trend: 'insufficient',
        delta: null,
      });
      expect(result.truncated).toBe(false);
      expect(result.scoreDomain).toEqual([1, 4]);
      expect(result.knowledgeScoreDomain).toEqual([0, 100]);
    });

    it('returns one entry per scored cut, platform-wide, with the cut context', async () => {
      const mine = [
        row(7, 1, 2.333, {
          sessionIds: ['a', 'b'],
          levels: { empathy: 2, rapport: 3 },
          unhelpful: true,
        }),
        // Cut 2 failed scoring: the gap shows as a missing ordinal.
        row(7, 3, 3, { sessionIds: ['c'], tenantId: 'org-b' }),
      ];
      await setup([row(1, 1, 2), row(1, 2, 2.5), ...mine]);
      repository.getLearnerIdentity.mockResolvedValue(identity);
      cuts.getSessionScenarios.mockResolvedValue(
        new Map([
          ['a', { scenarioId: 1, scenarioTitle: 'Grief' }],
          ['b', { scenarioId: 2, scenarioTitle: 'Exam stress' }],
          ['c', { scenarioId: 1, scenarioTitle: 'Grief' }],
        ]),
      );

      const result = await service.getLearnerSeries(7);

      // Platform-wide: no tenant on the read, whatever orgs the cuts are in.
      expect(cuts.getAllLearnerCuts).toHaveBeenCalledWith(
        FHS_RUBRIC_VERSION,
        undefined,
      );
      expect(cuts.getSessionScenarios).toHaveBeenCalledWith(['a', 'b', 'c']);
      expect(result.sessions).toEqual([
        {
          ordinal: 1,
          occurredAt: mine[0].closedAt.toISOString(),
          scenarioTitle: 'Grief · Exam stress',
          compositeScore: 2.33,
          skillCoverage: null,
          skillLevels: { empathy: 2, rapport: 3 },
          hasUnhelpfulBehaviour: true,
        },
        {
          ordinal: 3,
          occurredAt: mine[1].closedAt.toISOString(),
          scenarioTitle: 'Grief',
          compositeScore: 3,
          skillCoverage: null,
          skillLevels: { empathy: 2 },
          hasUnhelpfulBehaviour: false,
        },
      ]);
      expect(result.learner.evaluatedSessions).toBe(2);
      expect(result.rubricVersion).toBe(FHS_RUBRIC_VERSION);
    });

    it('classifies the learner exactly as the unfiltered list row', async () => {
      const rows = [
        ...[2, 2, 2.5, 3, 3].map((s, i) => row(7, i + 1, s)),
        ...[3, 3, 2, 2].map((s, i) => row(2, i + 1, s)),
        ...[2.4, 2.5, 2.5, 2.4].map((s, i) => row(3, i + 1, s)),
      ];
      await setup(rows);
      repository.getLearnerIdentity.mockResolvedValue(identity);

      const series = await service.getLearnerSeries(7);
      const list = await service.getLearnerTrends({});
      const listed = list.rows.find((r) => r.learnerId === 7);

      expect(series.learner).toMatchObject({
        evaluatedSessions: listed?.evaluatedSessions,
        firstWindowMean: listed?.firstWindowMean,
        lastWindowMean: listed?.lastWindowMean,
        delta: listed?.delta,
        band: listed?.band,
        trend: listed?.trend,
      });
      expect(series.thresholds).toEqual(list.thresholds);
    });

    it('flags a capped timeline as truncated', async () => {
      await setup(
        Array.from({ length: SKILL_GROWTH_LEARNER_ROW_CAP + 1 }, (_, i) =>
          row(7, i + 1, 2),
        ),
      );
      repository.getLearnerIdentity.mockResolvedValue(identity);

      const result = await service.getLearnerSeries(7);

      expect(result.sessions).toHaveLength(SKILL_GROWTH_LEARNER_ROW_CAP);
      expect(result.truncated).toBe(true);
      // Classified over every cut, not the capped page.
      expect(result.learner.evaluatedSessions).toBe(
        SKILL_GROWTH_LEARNER_ROW_CAP + 1,
      );
    });
  });
});
