import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  ScenarioOpportunityCoverageQueryDto,
  ScenarioOpportunityCoverageResponseDto,
  ScenarioRepeatImprovementQueryDto,
  ScenarioRepeatImprovementResponseDto,
} from '../dto/scenario-effectiveness-analytics.dto';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import { ScenarioEffectivenessAnalyticsRepository } from '../repository/scenario-effectiveness-analytics.repository';
import {
  REPEAT_MIN_SPAN_MS,
  REPEAT_PICKER_SIZE,
  SCENARIO_TAG_GAP_THRESHOLDS,
  buildOpportunityCoverage,
  buildRepeatImprovement,
  singleScenarioOf,
} from '../util/scenario-effectiveness.util';
import { withReportingQuerySlot } from '../../common/util/reporting-query-slots.util';

/**
 * Scenarios as practice content (Highlights → Curriculum, "Scenarios"):
 * which skills each scenario actually gives learners a chance to show
 * (AAQ-214), which of its tags it rarely delivers (AAQ-215), and whether
 * replaying the same scenario goes with a higher session score (AAQ-216).
 *
 * All the arithmetic lives in `util/scenario-effectiveness.util.ts`; this
 * service only reads, wires and labels. With no data both endpoints return
 * empty lists and zero counts, never a 404.
 */
@Injectable()
export class ScenarioEffectivenessAnalyticsService {
  constructor(
    private readonly repository: ScenarioEffectivenessAnalyticsRepository,
    private readonly cutsRepository: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getOpportunityCoverage(
    query: ScenarioOpportunityCoverageQueryDto = {},
  ): Promise<ScenarioOpportunityCoverageResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const cuts = await withReportingQuerySlot(() =>
      this.cutsRepository.getAllLearnerCuts(FHS_RUBRIC_VERSION, tenantId),
    );

    // Every session any cut touches, resolved to its scenario in ONE query.
    const sessionIds = [...new Set(cuts.flatMap((c) => c.sessionIds))];
    const sessions = await withReportingQuerySlot(() =>
      this.cutsRepository.getSessionScenarios(sessionIds),
    );
    const scenarioBySession = new Map<string, number | null>(
      [...sessions].map(([id, s]) => [id, s.scenarioId]),
    );

    const scenarioIds = [
      ...new Set(
        cuts
          .map((c) => singleScenarioOf(c.sessionIds, scenarioBySession))
          .filter((id): id is number => id !== null),
      ),
    ].sort((a, b) => a - b);
    const [meta, tags] = await Promise.all([
      withReportingQuerySlot(() =>
        this.repository.getScenarioMeta(scenarioIds, tenantId),
      ),
      withReportingQuerySlot(() =>
        this.repository.getScenarioTags(scenarioIds),
      ),
    ]);

    const built = buildOpportunityCoverage(
      cuts,
      scenarioBySession,
      meta,
      tags,
      {
        floor: MIN_SCORE_SAMPLE_SIZE,
        gapMaxPct: SCENARIO_TAG_GAP_THRESHOLDS.maxOpportunityPct,
        gapMinCuts: SCENARIO_TAG_GAP_THRESHOLDS.minCuts,
      },
    );

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      skills: FHS_RUBRIC.map((s) => ({
        skill: s.key,
        name: s.name,
        tier: s.tier,
      })),
      ...built,
      thresholds: { ...SCENARIO_TAG_GAP_THRESHOLDS },
      provenance: {
        derivation:
          `R1 — foundational helping skills cuts: each learner's roleplay speech in ` +
          `${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character slices, each scored by ` +
          `${FHS_JUDGE_MODEL} on the fixed 14-skill rubric (${FHS_RUBRIC_VERSION}). A cut counts ` +
          `toward a scenario only when every session in it played that scenario; a cell is the ` +
          `share of those cuts in which the judge found an opportunity for the skill (the same ` +
          `reading as "learners with a chance at each skill"). Tags map from seeded competency ` +
          `names to rubric skills. All time; test organisations excluded.`,
        note:
          `Opportunity is the judge's call under each skill's opportunity rule, not a property ` +
          `the scenario declares. Some skills depend on what the persona says — a self-harm cue ` +
          `exists only if the persona produces one — so a low share is a fact about the ` +
          `scenario's content, not the learners. Only single-scenario cuts are counted; check ` +
          `singleScenarioShare before reading the rows as all practice.`,
      },
      // Cuts carry the tenant of their session and play counts read the
      // session's own tenant, so nothing here stays platform-wide.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  async getRepeatImprovement(
    query: ScenarioRepeatImprovementQueryDto = {},
  ): Promise<ScenarioRepeatImprovementResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const groups = await withReportingQuerySlot(() =>
      this.repository.getRepeatGroups(tenantId),
    );
    const built = buildRepeatImprovement(groups, {
      floor: MIN_SCORE_SAMPLE_SIZE,
      scenarioId: query.scenarioId,
      minSpanMs: REPEAT_MIN_SPAN_MS,
      pickerSize: REPEAT_PICKER_SIZE,
    });

    return {
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      thresholds: {
        minSpanHours: REPEAT_MIN_SPAN_MS / 3_600_000,
        pickerSize: REPEAT_PICKER_SIZE,
      },
      ...built,
      provenance: {
        derivation:
          `R2 — scenario_sessions.score, the learner's session score (sum of the scenario's ` +
          `detected event scores). Per learner and scenario VERSION: first vs latest countable ` +
          `play, counted when there are 2+ plays and the two are at least ` +
          `${REPEAT_MIN_SPAN_MS / 3_600_000} hours apart. A score of 0 with no detected event is ` +
          `the unresolved case and is dropped. Per version: mean own change with a 95% bootstrap ` +
          `interval and a sign test, withheld below ${MIN_SCORE_SAMPLE_SIZE} pairs. Pooled: one ` +
          `vote per learner (up / down on balance), because raw points differ by scenario. All ` +
          `time; test organisations excluded.`,
        note:
          `Scores are comparable only within one scenario version; a version change starts a new ` +
          `pairing. A 0 can mean "unresolved" rather than a poor session. Learners practise other ` +
          `scenarios between plays, so a rise is associated with replaying, not caused by it.`,
      },
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
