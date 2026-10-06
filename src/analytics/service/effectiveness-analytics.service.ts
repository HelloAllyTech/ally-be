import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  EffectivenessFunnelQueryDto,
  EffectivenessFunnelResponseDto,
  FoundationalSkillsSegmentsQueryDto,
  FoundationalSkillsSegmentsResponseDto,
} from '../dto/effectiveness-analytics.dto';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import { EffectivenessAnalyticsRepository } from '../repository/effectiveness-analytics.repository';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  SEGMENT_DIMENSIONS,
  SegmentContext,
  SegmentDimension,
  buildEffectivenessFunnel,
  buildSegments,
  groupCutRows,
  resolveSegmentPanel,
} from '../util/effectiveness.util';
import { FHS_PROGRESS_THRESHOLDS } from '../util/foundational-skills-progress.util';

/**
 * Highlights → Effectiveness: the chain from an account to a measured
 * improvement (AAQ-203), and the Helping skills headline split by segment
 * (AAQ-204).
 *
 * Thin by design: it loads, hands the rows to `effectiveness.util` (where the
 * floors, the intersection and the segment rules are unit-tested), and labels
 * the result. The scored cuts are read through
 * `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` — the Helping
 * skills tab's own read — so the trend classes and the panel here are the ones
 * that tab shows for the same org filter.
 */
@Injectable()
export class EffectivenessAnalyticsService {
  constructor(
    private readonly repository: EffectivenessAnalyticsRepository,
    private readonly fhsRepository: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getFunnel(
    query: EffectivenessFunnelQueryDto,
  ): Promise<EffectivenessFunnelResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const [population, rows] = await Promise.all([
      this.repository.getFunnelPopulation(tenantId),
      this.fhsRepository.getAllLearnerCuts(FHS_RUBRIC_VERSION, tenantId),
    ]);
    const result = buildEffectivenessFunnel({
      population,
      cutLearners: groupCutRows(rows),
      minCohort: MIN_COHORT_SIZE,
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
    });
    const T = FHS_PROGRESS_THRESHOLDS;
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      trendMinCuts: T.trendMinCuts,
      ...result,
      provenance: {
        derivation:
          `Rulers: accounts and sessions for stages 1–3; R1 (foundational helping skills, rubric ` +
          `${FHS_RUBRIC_VERSION}) for stages 4–7. Stage 1 is learner-role accounts (the activation ` +
          `funnel's population); a countable session is ended, completed and not a preview or seed room. ` +
          `A cut is ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')} characters of the learner's own speech ` +
          `scored by ${FHS_JUDGE_MODEL}. "Improving" is the Helping skills classification: last half of ` +
          `the learner's cuts against their first half, beyond a band sized to the slice noise, ` +
          `${T.trendMinCuts}+ cuts needed.`,
        note:
          `All time; distinct learners; test organisations excluded. Each stage counts only learners in ` +
          `every stage above it (${result.clamp.outsideFunnel} of ${result.clamp.measuredLearners} ` +
          `measured learners sit outside the funnel: not a learner-role account, or one long session ` +
          `filled their first cut). Shares of people need ${MIN_COHORT_SIZE}; the improving split needs ` +
          `${MIN_SCORE_SAMPLE_SIZE} classifiable learners. A learner with fewer than ${T.trendMinCuts} cuts ` +
          `cannot be classified, so "improving" is a share of the classifiable, not of everyone. ` +
          `AI-judged; not yet checked against trained human raters.`,
      },
      scoping: {
        tenantId: tenantId ?? null,
        note: tenantId
          ? "Stages 1–3 narrowed by the learner's own org (as the activation funnel); stages 4–7 by the " +
            'org of the session each scored cut closed in (as Helping skills). A learner whose cuts were ' +
            'practised in another org is outside the funnel here.'
          : 'Every non-test org.',
      },
      computedAt: new Date().toISOString(),
    };
  }

  async getProgressSegments(
    query: FoundationalSkillsSegmentsQueryDto,
  ): Promise<FoundationalSkillsSegmentsResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const dimension: SegmentDimension = query.dimension ?? 'language';
    const rows = await this.fhsRepository.getAllLearnerCuts(
      FHS_RUBRIC_VERSION,
      tenantId,
    );
    const learners = groupCutRows(rows);
    const panel = resolveSegmentPanel(learners, {
      requestedCuts: query.cuts,
      baselineFrom: query.baselineFrom === 2 ? 2 : 1,
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
      minCohort: MIN_COHORT_SIZE,
    });
    const context = await this.loadSegmentContext(
      dimension,
      panel.learners.map((l) => l.userId),
      panel.sessionIds,
    );
    const result = buildSegments(learners, panel, {
      dimension,
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
      context,
    });
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      scoreDomain: [1, 4],
      dimensions: [...SEGMENT_DIMENSIONS],
      ...result,
      provenance: {
        derivation:
          `Ruler R1: each learner's roleplay speech is cut into ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-` +
          `character slices scored by ${FHS_JUDGE_MODEL} on the foundational helping skills rubric ` +
          `(${FHS_RUBRIC_VERSION}). The panel is Helping skills': learners whose first ${result.cuts} cuts ` +
          `are all scored, start = mean of cuts ${result.windows.early.join(', ')}, now = mean of cuts ` +
          `${result.windows.late.join(', ')}. Each panel learner is put in ONE ${SEGMENT_LABEL[dimension]} ` +
          `segment and each segment's change is the mean of its learners' own changes, with a paired ` +
          `bootstrap 95% CI and an exact sign test.`,
        note:
          `The overall row is the Helping skills headline (AAQ-168). Segments overlap with each other ` +
          `(language, org and course go together), so read one dimension at a time, and treat a gap ` +
          `between two segments as a hypothesis to check against the mix, not a finding — no test between ` +
          `segments is run. Segments under ${MIN_SCORE_SAMPLE_SIZE} learners are withheld with their count. ` +
          `${SEGMENT_CAVEAT[dimension]} All time; test organisations excluded. AI-judged; not yet checked ` +
          `against trained human raters.`,
      },
      scoping: {
        tenantId: tenantId ?? null,
        note: tenantId
          ? 'Cuts narrowed by the org of the session each closed in, as Helping skills.'
          : 'Every non-test org.',
      },
      computedAt: new Date().toISOString(),
    };
  }

  /** Only the lookup the requested dimension needs. */
  private async loadSegmentContext(
    dimension: SegmentDimension,
    userIds: number[],
    sessionIds: string[],
  ): Promise<SegmentContext> {
    switch (dimension) {
      case 'language':
      case 'difficulty':
      case 'difficultyTransition':
        return {
          sessions:
            await this.repository.getSessionSegmentAttributes(sessionIds),
        };
      case 'workerType':
        return { workerTypes: await this.repository.getWorkerTypes(userIds) };
      case 'course':
        return { courseStarts: await this.repository.getCourseStarts(userIds) };
      case 'orgSize':
        return { tenantAliases: await this.repository.getTenantAliases() };
    }
  }
}

const SEGMENT_LABEL: Record<SegmentDimension, string> = {
  language: 'language',
  workerType: 'worker-type',
  orgSize: 'org-size',
  course: 'course',
  difficulty: 'difficulty',
  difficultyTransition: 'start→now difficulty',
};

const SEGMENT_CAVEAT: Record<SegmentDimension, string> = {
  language:
    'Language is the majority language of the sessions in the learner\'s panel cuts; no majority is "mixed".',
  workerType:
    'Worker type is the label an org admin has set NOW, not when the practice happened; unset is its own group.',
  orgSize:
    "Org size counts the org's learners with a scored cut (1–9 / 10–49 / 50+), not its accounts.",
  course:
    'Course means the learner started a course before their "now" cuts — associated with, not caused by, the course; ' +
    'who chooses a course is not random.',
  difficulty:
    "Difficulty is the majority current difficulty of the scenarios in the learner's panel cuts; Medium is the default " +
    'for a scenario nobody tagged.',
  difficultyTransition:
    'Each learner is placed by the majority current difficulty of the scenarios in their start-window cuts and in their ' +
    'now-window cuts (e.g. Easy → Hard). A flat composite in an Easy → Hard row can be learning on harder material; ' +
    'Medium is the default for a scenario nobody tagged.',
};
