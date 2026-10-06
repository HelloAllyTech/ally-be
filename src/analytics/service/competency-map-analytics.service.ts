import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  CompetencyMapQueryDto,
  CompetencyMapResponseDto,
  CompetencyMapRowDto,
} from '../dto/competency-map-analytics.dto';
import {
  CompetencyMapAnalyticsRepository,
  UNATTRIBUTED_COMPETENCY_LABEL,
} from '../repository/competency-map-analytics.repository';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
// One floor for every judged score on the platform — see the constant's doc.
// A local copy here is how two charts on one tab end up suppressing at different
// sample sizes.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  buildCompetencyScores,
  singleScenarioOf,
} from '../util/competency-map.util';

/** The rubric's level scale. Fixed so a small spread cannot read as a chasm. */
const SCORE_DOMAIN: [number, number] = [1, 4];

export const COMPETENCY_MAP_DERIVATION =
  `Volume: completed sessions on scenarios carrying each competency tag. Score: learner ruler ` +
  `R1 (foundational helping skills) — each learner's roleplay speech is cut into ` +
  `${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character slices scored 1–4 per skill by ` +
  `${FHS_JUDGE_MODEL}; a competency's score is the mean level of the rubric skill it names, over ` +
  `slices practised wholly on one scenario carrying the tag that gave that skill an opportunity.`;

export const COMPETENCY_MAP_PROVENANCE_NOTE =
  `Slices spanning several scenarios cannot be credited to one scenario's tags and are left out ` +
  `(see the single-scenario share). A slice with no opportunity for the skill is skipped, never ` +
  `scored low. Competencies with no rubric equivalent (non-verbal, linking emotions, custom ones) ` +
  `show volume only. AI-judged, not yet checked against trained human raters; rubric ` +
  `${FHS_RUBRIC_VERSION}; test organisations excluded. Until October 2026 the score axis was the ` +
  `AI judge's 0–100 score of the AI roleplay character, not of the learner.`;

/**
 * The practice-volume vs. learner-level map for Highlights → Skill growth.
 *
 * Volume comes from the competency-map repository (sessions per scenario tag,
 * unchanged). The score comes from the learner ruler: every scored cut in
 * scope via `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts` (the one
 * definition of a scored cut), attributed to a scenario only when all its
 * sessions ran that scenario, then to that scenario's tags by the same
 * expansion the volume axis uses. The arithmetic is
 * `util/competency-map.util.ts`.
 *
 * Two rules live here because both are places a client could answer
 * differently: a row without a score keeps its volume (with a machine-readable
 * reason), and `belowFloor` is derived from the same comparison that nulls the
 * score, so a surface can never badge a scored row or leave a null unexplained.
 */
@Injectable()
export class CompetencyMapAnalyticsService {
  constructor(
    private readonly repository: CompetencyMapAnalyticsRepository,
    private readonly cuts: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getCompetencyMap(
    query: CompetencyMapQueryDto,
  ): Promise<CompetencyMapResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const [volume, cuts] = await Promise.all([
      this.repository.getCompetencyMap(tenantId),
      this.cuts.getAllLearnerCuts(FHS_RUBRIC_VERSION, tenantId),
    ]);
    const sessionScenario = await this.cuts.getSessionScenarios([
      ...new Set(cuts.flatMap((c) => c.sessionIds)),
    ]);
    const scenarioIds = new Set<number>();
    for (const c of cuts) {
      const id = singleScenarioOf(c.sessionIds, sessionScenario);
      if (id !== null) scenarioIds.add(id);
    }
    const scenarioTags = await this.repository.getScenarioCompetencyTags([
      ...scenarioIds,
    ]);

    const scores = buildCompetencyScores(
      volume.rows,
      cuts,
      sessionScenario,
      scenarioTags,
      MIN_SCORE_SAMPLE_SIZE,
    );

    const competencies: CompetencyMapRowDto[] = scores.rows.map((r) => ({
      competencyId: r.competencyId,
      name: r.name,
      completedSessions: r.completedSessions,
      learners: r.learners,
      scenarios: r.scenarios,
      skill: r.skill,
      skillName: r.skillName,
      score: r.score,
      taggedCuts: r.taggedCuts,
      scoredCuts: r.scoredCuts,
      scoreLearners: r.scoreLearners,
      scoreUnavailable: r.scoreUnavailable,
      // Released-client aliases (see the DTO): same numbers, old names.
      medianScore: r.score,
      evaluatedSessions: r.scoredCuts,
      belowFloor: r.scoreUnavailable === 'tooFewCuts',
    }));

    const attribution = scores.cutAttribution;

    return {
      competencies,
      unattributed: {
        completedSessions: volume.unattributed.completedSessions,
        scoredCuts: attribution.untaggedCuts,
        evaluatedSessions: attribution.untaggedCuts,
        label: UNATTRIBUTED_COMPETENCY_LABEL,
      },
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: SCORE_DOMAIN,
      rubricVersion: FHS_RUBRIC_VERSION,
      cutAttribution: attribution,
      summary: {
        competencies: competencies.length,
        // DISTINCT sessions, not the sum of the rows above: a session on a
        // multi-competency scenario is one session here and one row per
        // competency there.
        completedSessions: volume.totals.completedSessions,
        evaluatedSessions: attribution.singleScenarioCuts,
      },
      provenance: {
        derivation: COMPETENCY_MAP_DERIVATION,
        note: COMPETENCY_MAP_PROVENANCE_NOTE,
      },
      // Sessions and cuts carry a tenant; the competencies and scenarios they
      // point at are platform objects — nothing stays platform-wide.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
