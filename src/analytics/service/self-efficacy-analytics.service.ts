import { Injectable } from '@nestjs/common';

import {
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  SELF_EFFICACY_INSTRUMENT_VERSION,
  SelfEfficacyInstrument,
  currentSelfEfficacyInstrument,
} from 'src/foundational-skills/constants/self-efficacy-instrument.constants';
import {
  SelfEfficacyQueryDto,
  SelfEfficacyResponseDto,
} from '../dto/self-efficacy-analytics.dto';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import { SelfEfficacyAnalyticsRepository } from '../repository/self-efficacy-analytics.repository';
import {
  SELF_EFFICACY_CALIBRATION_BAND,
  SELF_EFFICACY_MATCH_WINDOW_DAYS,
  SELF_EFFICACY_MIN_SPEARMAN_POINTS,
  SELF_EFFICACY_POINT_CAP,
  SELF_EFFICACY_SAFETY_SKILL,
  SelfEfficacyAnswer,
  SelfEfficacyCut,
  buildSelfEfficacy,
} from '../util/self-efficacy.util';

const TIER_LABELS: Record<string, string> = {
  engage: 'Engage',
  understand: 'Understand',
  support: 'Support',
};

const nameOf = (skill: string): string =>
  FHS_RUBRIC.find((s) => s.key === skill)?.name ?? skill;

export const SELF_EFFICACY_CAVEAT =
  'Self-ratings are not an outcome on their own. Learners are poor and often over-confident ' +
  'self-assessors, and those who perform least well self-assess least well, so every confidence ' +
  'number here sits beside the judge’s level for the same people. The judge itself is not yet ' +
  'checked against human raters.';

/**
 * Assemble the response from the pure build (`util/self-efficacy.util.ts`):
 * labels, thresholds, the safety flag, provenance. Exported so the shape is
 * tested without a database.
 */
export function buildSelfEfficacyResponse(
  instrument: SelfEfficacyInstrument,
  answers: readonly SelfEfficacyAnswer[],
  cuts: readonly SelfEfficacyCut[],
  tenantId: string | null,
  now: Date = new Date(),
): SelfEfficacyResponseDto {
  const floor = MIN_SCORE_SAMPLE_SIZE;
  const built = buildSelfEfficacy(instrument, answers, cuts, {
    floor,
    windowDays: SELF_EFFICACY_MATCH_WINDOW_DAYS,
    band: SELF_EFFICACY_CALIBRATION_BAND,
    minSpearmanPoints: SELF_EFFICACY_MIN_SPEARMAN_POINTS,
    pointCap: SELF_EFFICACY_POINT_CAP,
  });

  const calibrationSkills = built.calibration.skills.map((s) => ({
    ...s,
    name: nameOf(s.skill),
  }));
  const harm = calibrationSkills.find(
    (s) => s.skill === SELF_EFFICACY_SAFETY_SKILL,
  );

  return {
    instrumentVersion: instrument.version,
    rubricVersion: FHS_RUBRIC_VERSION,
    minSampleSize: floor,
    minSpearmanPoints: SELF_EFFICACY_MIN_SPEARMAN_POINTS,
    coverage: {
      ...built.coverage,
      byTrigger: {
        ONBOARDING: built.coverage.byTrigger.ONBOARDING ?? 0,
        CUTS: built.coverage.byTrigger.CUTS ?? 0,
        COURSE: built.coverage.byTrigger.COURSE ?? 0,
      },
    },
    confidence: {
      learnersWithTwoOrMore: built.coverage.learnersWithTwoOrMore,
      selfDomain: [instrument.scale.min, instrument.scale.max],
      levelDomain: [1, 4],
      tiers: built.confidence.tiers.map((t) => ({
        ...t,
        label: TIER_LABELS[t.tier] ?? t.tier,
      })),
      skills: built.confidence.skills.map((s) => ({
        ...s,
        name: nameOf(s.skill),
      })),
    },
    calibration: {
      thresholds: {
        rescale: '1 + 3·r/10',
        band: SELF_EFFICACY_CALIBRATION_BAND,
        matchWindowDays: SELF_EFFICACY_MATCH_WINDOW_DAYS,
      },
      skills: calibrationSkills,
      overall: built.calibration.overall,
      points: built.calibration.points,
      pointsTotal: built.calibration.pointsTotal,
      pointsTruncated: built.calibration.pointsTruncated,
      pointCap: SELF_EFFICACY_POINT_CAP,
      safetyFlag: {
        skill: SELF_EFFICACY_SAFETY_SKILL,
        name: nameOf(SELF_EFFICACY_SAFETY_SKILL),
        learners: harm?.learners ?? 0,
        overConfident: harm?.overConfident ?? 0,
        overConfidentPct: harm?.overConfidentPct ?? null,
        internal: true,
        note:
          'Learners sure they assess harm well whom the judge scores lower. Derived from unaudited ' +
          'judge coding of risk behaviours — internal; share only privately with partners.',
      },
    },
    caveat: SELF_EFFICACY_CAVEAT,
    provenance: {
      derivation:
        `Self-rating: learner_self_assessments, instrument ${instrument.version} (14 items, 0–10, one per ` +
        `helping skill; tiers are the mean of their items). Judge: ruler R1, foundational_skill_assessments ` +
        `${FHS_RUBRIC_VERSION}, SCORED. Confidence start → now: each learner's first vs latest answer over the ` +
        `items rated both times, beside the judged level at the cut nearest each answer ` +
        `(±${SELF_EFFICACY_MATCH_WINDOW_DAYS} days, two different cuts). Calibration: each rated item against ` +
        `the nearest cut (±${SELF_EFFICACY_MATCH_WINDOW_DAYS} days) where the skill was assessable, self ` +
        `rescaled 1 + 3·r/10, over-/under-confident beyond ±${SELF_EFFICACY_CALIBRATION_BAND} levels, one ` +
        `point per learner (their latest). All time; test orgs excluded.`,
      note:
        `${SELF_EFFICACY_CAVEAT} Withheld below ${floor} learners (Spearman below ` +
        `${SELF_EFFICACY_MIN_SPEARMAN_POINTS}); counts travel. A change over time is associated with ` +
        `practice, not shown to be caused by it.`,
    },
    scoping: {
      tenantId,
      note: tenantId
        ? 'Answers by the org the learner was in when they answered; judged cuts by the org of the session each closed in, so practice in another org is not matched.'
        : 'Every non-test org.',
    },
    computedAt: now.toISOString(),
  };
}

/**
 * GET /v1/analytics/foundational-skills/self-efficacy (EFF-71 / AAQ-230,
 * EFF-72 / AAQ-231). Two reads — every answer of the current instrument
 * version and every scored cut of the current rubric version — and the rest
 * in memory, like the other Helping skills endpoints at today's volume.
 */
@Injectable()
export class SelfEfficacyAnalyticsService {
  constructor(
    private readonly repository: SelfEfficacyAnalyticsRepository,
    private readonly cuts: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getSelfEfficacy(
    query: SelfEfficacyQueryDto,
  ): Promise<SelfEfficacyResponseDto> {
    const tenantId = query.tenantId ?? null;
    const [answers, cuts] = await Promise.all([
      this.repository.getAnswers(
        SELF_EFFICACY_INSTRUMENT_VERSION,
        tenantId ?? undefined,
      ),
      this.cuts.getAllLearnerCuts(FHS_RUBRIC_VERSION, tenantId ?? undefined),
    ]);
    return buildSelfEfficacyResponse(
      currentSelfEfficacyInstrument(),
      answers,
      cuts,
      tenantId,
    );
  }
}
