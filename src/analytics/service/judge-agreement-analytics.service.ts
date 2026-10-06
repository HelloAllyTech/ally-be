import { Injectable } from '@nestjs/common';

import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { HUMAN_RATING_SAMPLE_PER_QUARTER } from 'src/foundational-skills/constants/fhs-human-rating.constants';
import type { StoredSkillVerdict } from 'src/foundational-skills/entity/foundational-skill-assessment.entity';
import {
  quarterKeyOf,
  selectQuarterSample,
} from 'src/foundational-skills/util/human-rating.util';
import {
  JudgeAgreementComparisonDto,
  JudgeAgreementCoverageDto,
  JudgeAgreementQuarterDto,
  JudgeAgreementResponseDto,
  JudgeAgreementSkillDto,
} from '../dto/judge-agreement-analytics.dto';
import {
  JudgeAgreementAnalyticsRepository,
  JudgeAgreementExclusions,
  JudgeAgreementPopulationRow,
  JudgeAgreementRatingRow,
} from '../repository/judge-agreement-analytics.repository';
import {
  MIN_RATED_CUTS_FOR_AGREEMENT,
  RatedPair,
  binaryAgreement,
  levelAgreement,
} from '../util/rater-agreement.util';

const DERIVATION =
  'R1, checked: people rate a stratified sample of foundational-skills cuts ' +
  `(${HUMAN_RATING_SAMPLE_PER_QUARTER} per calendar quarter, composite tercile × session ` +
  'language) against the same rubric, ticking behaviour codes; each level is derived ' +
  "from the ticks with the judge's own rule. Judge vs human: one pair per human " +
  'rating, pooled across raters. Human vs human: every pair of raters of the same ' +
  "cut. Per skill: Cohen's κ on whether an opportunity arose, and — where both " +
  'found one — κ unweighted and quadratic-weighted on the 1–4 level, and % exact. ' +
  'The cut-level any-unhelpful flag likewise. One rubric version; test orgs excluded; ' +
  'all time, platform-wide.';

const NOTE =
  'Agreement, not truth: people can share a blind spot with each other and with ' +
  'the judge. Human vs human is the ceiling to read the judge against — a judge ' +
  'that agrees with raters about as well as they agree with each other is as good ' +
  'as this rubric allows. κ is withheld below ' +
  `${MIN_RATED_CUTS_FOR_AGREEMENT} rated cuts per skill, and even at that size it ` +
  'is imprecise. Skills that rarely get an opportunity reach the floor last.';

/** One skill's verdict, looked up by key. */
const bySkill = (
  verdicts: readonly StoredSkillVerdict[],
): Map<string, StoredSkillVerdict> =>
  new Map(verdicts.map((v) => [v.skill, v]));

interface SidePair {
  cutId: string;
  first: Map<string, StoredSkillVerdict>;
  second: Map<string, StoredSkillVerdict>;
  firstUnhelpful: boolean | null;
  secondUnhelpful: boolean | null;
}

function comparison(
  pairs: readonly SidePair[],
  skill: string,
  directional: boolean,
): JudgeAgreementComparisonDto {
  const opportunity: RatedPair[] = [];
  const level: RatedPair[] = [];
  for (const p of pairs) {
    const a = p.first.get(skill);
    const b = p.second.get(skill);
    if (!a || !b) continue;
    opportunity.push({
      cutId: p.cutId,
      a: a.opportunity ? 1 : 0,
      b: b.opportunity ? 1 : 0,
    });
    if (
      a.opportunity &&
      b.opportunity &&
      a.level !== null &&
      b.level !== null
    ) {
      level.push({ cutId: p.cutId, a: a.level, b: b.level });
    }
  }
  return {
    opportunity: binaryAgreement(opportunity),
    level: levelAgreement(level, { directional }),
  };
}

function unhelpfulPairs(pairs: readonly SidePair[]): RatedPair[] {
  return pairs
    .filter((p) => p.firstUnhelpful !== null && p.secondUnhelpful !== null)
    .map((p) => ({
      cutId: p.cutId,
      a: p.firstUnhelpful ? 1 : 0,
      b: p.secondUnhelpful ? 1 : 0,
    }));
}

/** Judge vs each human rating: one pair per rating. */
function judgeVsHumanPairs(
  ratings: readonly JudgeAgreementRatingRow[],
): SidePair[] {
  return ratings.map((r) => ({
    cutId: r.cutId,
    first: bySkill(r.judgeVerdicts),
    second: bySkill(r.humanVerdicts),
    firstUnhelpful: r.judgeUnhelpful,
    secondUnhelpful: r.humanUnhelpful,
  }));
}

/**
 * Every pair of people who rated the same cut, the lower user id first — an
 * arbitrary but fixed order, so the same ratings always give the same κ.
 */
function humanVsHumanPairs(
  ratings: readonly JudgeAgreementRatingRow[],
): SidePair[] {
  const byCut = new Map<string, JudgeAgreementRatingRow[]>();
  for (const r of ratings) {
    const list = byCut.get(r.cutId) ?? [];
    list.push(r);
    byCut.set(r.cutId, list);
  }
  const out: SidePair[] = [];
  for (const [cutId, list] of byCut) {
    const sorted = [...list].sort((a, b) => a.raterId - b.raterId);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        out.push({
          cutId,
          first: bySkill(sorted[i].humanVerdicts),
          second: bySkill(sorted[j].humanVerdicts),
          firstUnhelpful: sorted[i].humanUnhelpful,
          secondUnhelpful: sorted[j].humanUnhelpful,
        });
      }
    }
  }
  return out;
}

/**
 * Re-draw each quarter's sample from the population (the same pure rule the
 * raters' API uses) and count how far rating has got in it.
 */
function coverageOf(
  ratings: readonly JudgeAgreementRatingRow[],
  population: readonly JudgeAgreementPopulationRow[],
  exclusions: JudgeAgreementExclusions,
  now: Date,
): JudgeAgreementCoverageDto {
  const ratersPerCut = new Map<string, number>();
  for (const r of ratings) {
    ratersPerCut.set(r.cutId, (ratersPerCut.get(r.cutId) ?? 0) + 1);
  }
  const byQuarter = new Map<string, JudgeAgreementPopulationRow[]>();
  for (const p of population) {
    const list = byQuarter.get(p.quarter) ?? [];
    list.push(p);
    byQuarter.set(p.quarter, list);
  }
  const currentQuarter = quarterKeyOf(now);
  const sampledIds = new Set<string>();
  const quarters: JudgeAgreementQuarterDto[] = [...byQuarter.keys()]
    .sort()
    .map((quarter) => {
      const sample = selectQuarterSample(
        byQuarter.get(quarter) ?? [],
        quarter,
        HUMAN_RATING_SAMPLE_PER_QUARTER,
      );
      let rated = 0;
      let multi = 0;
      for (const { candidate } of sample.items) {
        sampledIds.add(candidate.cutId);
        const n = ratersPerCut.get(candidate.cutId) ?? 0;
        if (n >= 1) rated += 1;
        if (n >= 2) multi += 1;
      }
      return {
        quarter,
        complete: quarter < currentQuarter,
        population: sample.population,
        sampled: sample.items.length,
        sampledRated: rated,
        sampledMultiRated: multi,
      };
    });
  const ratedCutIds = [...ratersPerCut.keys()];
  return {
    quarters: quarters.length,
    sampledCuts: quarters.reduce((s, q) => s + q.sampled, 0),
    ratedCuts: ratedCutIds.length,
    ratedSampledCuts: ratedCutIds.filter((id) => sampledIds.has(id)).length,
    multiRatedCuts: [...ratersPerCut.values()].filter((n) => n >= 2).length,
    ratings: ratings.length,
    raters: new Set(ratings.map((r) => r.raterId)).size,
    excludedOtherRubricVersion: exclusions.otherRubricVersion,
    excludedNoJudgement: exclusions.noJudgement,
    byQuarter: quarters,
  };
}

/**
 * The whole response from rows — pure, so the pairing, the floors and the
 * status are tested without a database.
 */
export function buildJudgeAgreement(input: {
  rubricVersion: string;
  ratings: readonly JudgeAgreementRatingRow[];
  population: readonly JudgeAgreementPopulationRow[];
  exclusions: JudgeAgreementExclusions;
  now: Date;
}): JudgeAgreementResponseDto {
  const jh = judgeVsHumanPairs(input.ratings);
  const hh = humanVsHumanPairs(input.ratings);
  const skills: JudgeAgreementSkillDto[] = FHS_RUBRIC.map((s) => ({
    skill: s.key,
    name: s.name,
    tier: s.tier,
    judgeVsHuman: comparison(jh, s.key, true),
    humanVsHuman: comparison(hh, s.key, false),
  }));
  const status: JudgeAgreementResponseDto['status'] =
    input.ratings.length === 0
      ? 'notYetMeasured'
      : skills.some((s) => s.judgeVsHuman.level.kappa !== null)
        ? 'measured'
        : 'collecting';
  return {
    status,
    rubricVersion: input.rubricVersion,
    minSampleSize: MIN_RATED_CUTS_FOR_AGREEMENT,
    samplePerQuarter: HUMAN_RATING_SAMPLE_PER_QUARTER,
    skills,
    unhelpful: {
      judgeVsHuman: binaryAgreement(unhelpfulPairs(jh)),
      humanVsHuman: binaryAgreement(unhelpfulPairs(hh)),
    },
    coverage: coverageOf(
      input.ratings,
      input.population,
      input.exclusions,
      input.now,
    ),
    provenance: { derivation: DERIVATION, note: NOTE },
    computedAt: input.now.toISOString(),
  };
}

@Injectable()
export class JudgeAgreementAnalyticsService {
  constructor(private readonly repository: JudgeAgreementAnalyticsRepository) {}

  async getJudgeAgreement(): Promise<JudgeAgreementResponseDto> {
    const [ratings, population, exclusions] = await Promise.all([
      this.repository.getRatings(FHS_RUBRIC_VERSION),
      this.repository.getPopulation(FHS_RUBRIC_VERSION),
      this.repository.getExclusions(FHS_RUBRIC_VERSION),
    ]);
    return buildJudgeAgreement({
      rubricVersion: FHS_RUBRIC_VERSION,
      ratings,
      population,
      exclusions,
      now: new Date(),
    });
  }
}
