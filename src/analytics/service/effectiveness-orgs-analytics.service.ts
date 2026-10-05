import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  CostPerImprovementQueryDto,
  CostPerImprovementResponseDto,
  EffectivenessOrgsQueryDto,
  EffectivenessOrgsResponseDto,
} from '../dto/effectiveness-orgs-analytics.dto';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import { EffectivenessOrgsAnalyticsRepository } from '../repository/effectiveness-orgs-analytics.repository';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import { TASK_AREA } from '../repository/roleplay-cost-analytics.repository';
import {
  ORG_SPARK_MIN_CUTS,
  buildCostPerImprovement,
  buildOrgScorecard,
  windowBounds,
} from '../util/effectiveness-orgs.util';
import { FHS_PROGRESS_THRESHOLDS } from '../util/foundational-skills-progress.util';
import { RoleplayCostAnalyticsService } from './roleplay-cost-analytics.service';

const COST_CAVEAT =
  'Spend is attributable to every learner who practised; improvement only to the measurable ' +
  'subset (learners with enough scored practice to be classified), and is not caused by spend ' +
  'alone. Read this as a ceiling on what one improvement costs, not a unit price.';

/**
 * Highlights → Orgs "Org effectiveness scorecard" (EFF-90, AAQ-232) and
 * Highlights → Effectiveness "Cost per improved learner" (EFF-61, AAQ-218).
 *
 * Both read EVERY scored cut once, platform-wide, and do the rest in memory
 * (`effectiveness-orgs.util`): one pass over all tenants rather than one
 * progress computation per tenant, so every org is held to the same noise band
 * and the same rules. The rules live in the util; this service loads, wires
 * and labels.
 */
@Injectable()
export class EffectivenessOrgsAnalyticsService {
  constructor(
    private readonly repository: EffectivenessOrgsAnalyticsRepository,
    private readonly cuts: FoundationalSkillsAnalyticsRepository,
    private readonly roleplayCost: RoleplayCostAnalyticsService,
  ) {}

  async getOrgScorecard(
    query: EffectivenessOrgsQueryDto,
  ): Promise<EffectivenessOrgsResponseDto> {
    const [rows, tenants, enrolments] = await Promise.all([
      this.cuts.getAllLearnerCuts(FHS_RUBRIC_VERSION),
      this.repository.getOrgs(),
      this.repository.getEnrolmentCounts(),
    ]);
    const result = buildOrgScorecard({
      rows,
      tenants,
      enrolments,
      now: new Date(),
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
      minCohort: MIN_COHORT_SIZE,
      tenantId: query.tenantId,
    });
    const tenantId = query.tenantId ?? null;
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      thresholds: {
        trendMinCuts: FHS_PROGRESS_THRESHOLDS.trendMinCuts,
        learnerBandZ: FHS_PROGRESS_THRESHOLDS.learnerBandZ,
      },
      scoreDomain: [1, 4],
      cutNoiseSd: result.cutNoiseSd,
      sparkMonths: result.months,
      sparkMinCuts: ORG_SPARK_MIN_CUTS,
      summary: result.summary,
      platform: result.platform,
      orgs: result.orgs,
      scoping: {
        tenantId,
        unscopedSections: tenantId ? ['platform', 'summary', 'cutNoiseSd'] : [],
      },
      provenance: {
        derivation:
          `R1 — each learner's roleplay speech is cut into ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
          `slices scored by ${FHS_JUDGE_MODEL} on the foundational helping-skills rubric (composite 1–4); a ` +
          `cut belongs to the org of the session it closed in. Per org, each learner with ` +
          `${FHS_PROGRESS_THRESHOLDS.trendMinCuts}+ cuts there is compared with themselves: first half of ` +
          `their cuts vs last half, paired bootstrap 95% CI. Improving = above the noise band estimated over ` +
          `every learner on the platform. R10 — course completion = completed ÷ started enrolments, by the ` +
          `learner's own org.`,
        note:
          `All time. Orgs with fewer than ${MIN_SCORE_SAMPLE_SIZE} measurable learners (2+ cuts) show counts ` +
          `only. Own-baseline change is associated with practice, not caused by it. Self-harm follow-up is ` +
          `unaudited judge coding: internal, share only privately with partners. AI-judged; not yet checked ` +
          `against trained human raters. Rubric ${FHS_RUBRIC_VERSION}; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * The numerator is the roleplay-cost endpoint's own total
   * (`totalAttributableCostUsd`, the AAQ-076 KPI) for the same window query —
   * called, not re-derived, so pricing stays in one place and the two tiles
   * cannot disagree. The denominator then uses that response's echoed window.
   */
  async getCostPerImprovement(
    query: CostPerImprovementQueryDto,
  ): Promise<CostPerImprovementResponseDto> {
    const [cost, rows] = await Promise.all([
      this.roleplayCost.getRoleplayCost({
        range: query.range,
        from: query.from,
        to: query.to,
      }),
      this.cuts.getAllLearnerCuts(FHS_RUBRIC_VERSION),
    ]);
    const { start, endExclusive } = windowBounds(cost.window);
    const learnersWithSpend = await this.repository.getLearnersWithSpend(
      start,
      endExclusive,
      Object.keys(TASK_AREA),
    );
    const result = buildCostPerImprovement({
      rows,
      start,
      endExclusive,
      spendUsd: cost.totalAttributableCostUsd,
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
    });
    return {
      window: cost.window,
      spendUsd: result.spendUsd,
      unpricedCalls: cost.totalUnpricedCalls,
      improvedLearners: result.improvedLearners,
      classifiedLearners: result.classifiedLearners,
      costPerImprovedLearnerUsd: result.costPerImprovedLearnerUsd,
      learnersWithSpend,
      improvingAllTime: result.improvingAllTime,
      classifiableAllTime: result.classifiableAllTime,
      measuredLearners: result.measuredLearners,
      cutNoiseSd: result.cutNoiseSd,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      rubricVersion: FHS_RUBRIC_VERSION,
      caveat: COST_CAVEAT,
      scoping: {
        tenantId: null,
        unscopedSections: [
          'spendUsd',
          'improvedLearners',
          'costPerImprovedLearnerUsd',
          'learnersWithSpend',
        ],
      },
      provenance: {
        derivation:
          `Spend: learner-caused AI spend in the window (live roleplay, feedback & summary, quiz grading), ` +
          `priced at read time from a hand-maintained list — the AAQ-076 figure. Improved learners: R1, ` +
          `foundational helping-skills cuts scored by ${FHS_JUDGE_MODEL}; a learner with ` +
          `${FHS_PROGRESS_THRESHOLDS.trendMinCuts}+ scored cuts is improving when the last half of their cuts ` +
          `is above the first half by more than the platform noise band, and counts here when their last ` +
          `scored cut closed inside the window.`,
        note:
          `${COST_CAVEAT} Withheld below ${MIN_SCORE_SAMPLE_SIZE} improved learners. Platform-wide by ` +
          `construction (most AI usage carries no org). An estimate, not a bill: ignores prompt-cache ` +
          `discounts and negotiated rates. Rubric ${FHS_RUBRIC_VERSION}; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }
}
