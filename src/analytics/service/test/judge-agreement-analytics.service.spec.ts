import { FHS_SKILL_KEYS } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import type { StoredSkillVerdict } from 'src/foundational-skills/entity/foundational-skill-assessment.entity';
import {
  JudgeAgreementPopulationRow,
  JudgeAgreementRatingRow,
} from '../../repository/judge-agreement-analytics.repository';
import { MIN_RATED_CUTS_FOR_AGREEMENT } from '../../util/rater-agreement.util';
import {
  JudgeAgreementAnalyticsService,
  buildJudgeAgreement,
} from '../judge-agreement-analytics.service';

const NOW = new Date('2026-10-05T12:00:00Z');

/** Every skill without an opportunity, except `verbal` at `verbalLevel`. */
const verdicts = (
  verbalLevel: 1 | 2 | 3 | 4 | null,
  extra: Partial<Record<string, StoredSkillVerdict>> = {},
): StoredSkillVerdict[] =>
  FHS_SKILL_KEYS.map(
    (skill) =>
      extra[skill] ??
      (skill === 'verbal' && verbalLevel !== null
        ? {
            skill,
            opportunity: true,
            level: verbalLevel,
            observed: [],
            notApplicable: [],
          }
        : {
            skill,
            opportunity: false,
            level: null,
            observed: [],
            notApplicable: [],
          }),
  );

const rating = (
  cutId: string,
  raterId: number,
  judge: 1 | 2 | 3 | 4 | null,
  human: 1 | 2 | 3 | 4 | null,
  unhelpful: { judge?: boolean | null; human?: boolean } = {},
): JudgeAgreementRatingRow => ({
  cutId,
  raterId,
  judgeVerdicts: verdicts(judge),
  humanVerdicts: verdicts(human),
  judgeUnhelpful: unhelpful.judge === undefined ? judge === 1 : unhelpful.judge,
  humanUnhelpful: unhelpful.human ?? human === 1,
});

const population = (
  n: number,
  quarter = '2026Q3',
): JudgeAgreementPopulationRow[] =>
  Array.from({ length: n }, (_, i) => ({
    cutId: `${quarter}-cut-${i}`,
    quarter,
    compositeScore: 1 + (i % 30) / 10,
    language: 'en',
  }));

const build = (
  ratings: JudgeAgreementRatingRow[],
  pop: JudgeAgreementPopulationRow[] = [],
  exclusions = { otherRubricVersion: 0, noJudgement: 0 },
) =>
  buildJudgeAgreement({
    rubricVersion: 'fhs-text-v1',
    ratings,
    population: pop,
    exclusions,
    now: NOW,
  });

describe('buildJudgeAgreement', () => {
  it('reads "not yet measured" with every statistic null when no one has rated', () => {
    const out = build([], population(40), {
      otherRubricVersion: 3,
      noJudgement: 1,
    });
    expect(out.status).toBe('notYetMeasured');
    expect(out.minSampleSize).toBe(MIN_RATED_CUTS_FOR_AGREEMENT);
    expect(out.samplePerQuarter).toBe(30);
    expect(out.skills.map((s) => s.skill)).toEqual([...FHS_SKILL_KEYS]);
    for (const s of out.skills) {
      for (const c of [s.judgeVsHuman, s.humanVsHuman]) {
        expect(c.level).toMatchObject({
          pairs: 0,
          cuts: 0,
          kappa: null,
          weightedKappa: null,
          exactAgreementPct: null,
          meanDifference: null,
        });
        expect(c.opportunity).toMatchObject({
          pairs: 0,
          kappa: null,
          agreementPct: null,
        });
      }
    }
    expect(out.unhelpful.judgeVsHuman.kappa).toBeNull();
    // Coverage still reports what there is to rate, and what was excluded.
    expect(out.coverage).toMatchObject({
      quarters: 1,
      sampledCuts: 30,
      ratedCuts: 0,
      ratings: 0,
      raters: 0,
      excludedOtherRubricVersion: 3,
      excludedNoJudgement: 1,
    });
    expect(out.coverage.byQuarter).toEqual([
      {
        quarter: '2026Q3',
        complete: true,
        population: 40,
        sampled: 30,
        sampledRated: 0,
        sampledMultiRated: 0,
      },
    ]);
  });

  it('is "collecting" while ratings exist but no skill reaches the floor', () => {
    const out = build([rating('c1', 7, 3, 3), rating('c2', 7, 2, 3)]);
    expect(out.status).toBe('collecting');
    const verbal = out.skills.find((s) => s.skill === 'verbal')!;
    expect(verbal.judgeVsHuman.level).toMatchObject({
      pairs: 2,
      cuts: 2,
      kappa: null,
    });
    // The counts travel below the floor.
    expect(verbal.judgeVsHuman.level.confusion[2][2]).toBe(1);
    expect(verbal.judgeVsHuman.level.confusion[1][2]).toBe(1);
  });

  it('measures judge vs human at the floor: one pair per rating, judge − human direction', () => {
    const ratings = [
      ...Array.from({ length: 12 }, (_, i) => rating(`a${i}`, 7, 3, 3)),
      ...Array.from({ length: 6 }, (_, i) => rating(`b${i}`, 7, 2, 2)),
      ...Array.from({ length: 2 }, (_, i) => rating(`c${i}`, 7, 4, 3)),
    ];
    const out = build(ratings);
    expect(out.status).toBe('measured');
    const verbal = out.skills.find((s) => s.skill === 'verbal')!.judgeVsHuman;
    expect(verbal.level.cuts).toBe(20);
    expect(verbal.level.exactAgreementPct).toBe(90);
    expect(verbal.level.meanDifference).toBe(0.1);
    expect(verbal.level.kappa).not.toBeNull();
    expect(verbal.level.weightedKappa).toBeGreaterThan(verbal.level.kappa!);
    // Opportunity: every pair "both found" for verbal, so κ is undefined but % is 100.
    expect(verbal.opportunity).toMatchObject({
      both: 20,
      onlyFirst: 0,
      onlySecond: 0,
      neither: 0,
      kappa: null,
      agreementPct: 100,
    });
    // A skill neither side ever found: all "neither", nothing to compare on level.
    const hope = out.skills.find((s) => s.skill === 'hope')!.judgeVsHuman;
    expect(hope.opportunity.neither).toBe(20);
    expect(hope.level.pairs).toBe(0);
  });

  it('compares level only where BOTH found an opportunity; opportunity κ counts the rest', () => {
    const out = build([
      rating('c1', 7, 3, null), // judge found it, human did not
      rating('c2', 7, null, 2), // human found it, judge did not
      rating('c3', 7, 3, 3),
    ]);
    const verbal = out.skills.find((s) => s.skill === 'verbal')!.judgeVsHuman;
    expect(verbal.opportunity).toMatchObject({
      pairs: 3,
      both: 1,
      onlyFirst: 1,
      onlySecond: 1,
      neither: 0,
    });
    expect(verbal.level.pairs).toBe(1);
  });

  it('pairs every two raters of the same cut for human vs human, lower id first', () => {
    const out = build([
      rating('c1', 9, 3, 2),
      rating('c1', 4, 3, 3),
      rating('c1', 6, 3, 4),
      rating('c2', 4, 2, 2), // single rater: no human pair
    ]);
    const verbal = out.skills.find((s) => s.skill === 'verbal')!;
    // 3 raters on c1 → 3 pairs; judge vs human → 4 pairs.
    expect(verbal.humanVsHuman.level.pairs).toBe(3);
    expect(verbal.humanVsHuman.level.cuts).toBe(1);
    expect(verbal.judgeVsHuman.level.pairs).toBe(4);
    // (4,6) → 3 vs 4, (4,9) → 3 vs 2, (6,9) → 4 vs 2 — rows are the lower id.
    const m = verbal.humanVsHuman.level.confusion;
    expect(m[2][3]).toBe(1);
    expect(m[2][1]).toBe(1);
    expect(m[3][1]).toBe(1);
    expect(verbal.humanVsHuman.level.meanDifference).toBeNull();
    expect(out.coverage).toMatchObject({
      ratedCuts: 2,
      multiRatedCuts: 1,
      ratings: 4,
      raters: 3,
    });
  });

  it('compares the any-unhelpful flag, skipping a judge row with no flag', () => {
    const out = build([
      rating('c1', 7, 1, 1),
      rating('c2', 7, 3, 1),
      rating('c3', 7, 3, 3, { judge: null }),
    ]);
    expect(out.unhelpful.judgeVsHuman).toMatchObject({
      pairs: 2,
      both: 1,
      onlySecond: 1,
      onlyFirst: 0,
      neither: 0,
    });
  });

  it('re-draws each quarter’s sample to count rated sampled cuts', () => {
    const pop = [...population(10, '2026Q2'), ...population(50, '2026Q4')];
    const out = build(
      [
        rating('2026Q2-cut-1', 7, 3, 3),
        rating('2026Q2-cut-1', 8, 3, 2),
        rating('2026Q2-cut-2', 7, 2, 2),
      ],
      pop,
    );
    expect(out.coverage.byQuarter).toEqual([
      {
        quarter: '2026Q2',
        complete: true,
        population: 10,
        sampled: 10,
        sampledRated: 2,
        sampledMultiRated: 1,
      },
      {
        quarter: '2026Q4',
        complete: false, // NOW is inside 2026Q4
        population: 50,
        sampled: 30,
        sampledRated: 0,
        sampledMultiRated: 0,
      },
    ]);
    expect(out.coverage).toMatchObject({
      quarters: 2,
      sampledCuts: 40,
      ratedCuts: 2,
      ratedSampledCuts: 2,
    });
  });

  it('names the ruler and the caveat', () => {
    const out = build([]);
    expect(out.provenance.derivation).toMatch(/^R1/);
    expect(out.provenance.note).toMatch(/Agreement, not truth/);
    expect(out.computedAt).toBe(NOW.toISOString());
  });
});

describe('JudgeAgreementAnalyticsService', () => {
  it('reads every query under the pinned rubric version', async () => {
    const repository = {
      getRatings: jest.fn().mockResolvedValue([]),
      getPopulation: jest.fn().mockResolvedValue([]),
      getExclusions: jest
        .fn()
        .mockResolvedValue({ otherRubricVersion: 0, noJudgement: 0 }),
    };
    const out = await new JudgeAgreementAnalyticsService(
      repository as any,
    ).getJudgeAgreement();
    expect(repository.getRatings).toHaveBeenCalledWith('fhs-text-v1');
    expect(repository.getPopulation).toHaveBeenCalledWith('fhs-text-v1');
    expect(repository.getExclusions).toHaveBeenCalledWith('fhs-text-v1');
    expect(out.rubricVersion).toBe('fhs-text-v1');
    expect(out.status).toBe('notYetMeasured');
  });
});
