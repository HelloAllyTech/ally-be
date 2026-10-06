import { Injectable } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FoundationalSkillsEffectivenessQueryDto,
  PracticeProgressionResponseDto,
  SkillRetentionResponseDto,
  TimeToCompetenceResponseDto,
} from '../dto/foundational-skills-effectiveness.dto';
import { AnalyticsScopingDto } from '../dto/platform-analytics.dto';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import {
  FoundationalSkillsAnalyticsRepository,
  FoundationalSkillsLearnerCutRow,
} from '../repository/foundational-skills-analytics.repository';
import { FoundationalSkillsEffectivenessRepository } from '../repository/foundational-skills-effectiveness.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  FHS_COMPETENCE_LEVEL,
  PRACTICE_DIFFICULTY_LEVELS,
  PRACTICE_PROGRESSION_MAX_ORDINAL,
  RETENTION_GAP_BANDS,
  RETENTION_MIN_LEARNERS,
  TIER_COMPETENCE_EXCLUDED_SKILLS,
  TIER_COMPETENCE_EXCLUSION_REASONS,
  TIER_COMPETENCE_SKILLS,
  buildPracticeProgression,
  tierCompetenceSkillKeys,
  competenceReaches,
  computeRetention,
  computeTimeToCompetence,
} from '../util/foundational-skills-effectiveness.util';

/** A response's org scope. Every section here follows the filter. */
const scoping = (tenantId?: string): AnalyticsScopingDto => ({
  tenantId: tenantId ?? null,
  unscopedSections: [],
});

/** One learner's rows, oldest cut first (the repository already orders them). */
function byLearner(
  rows: readonly FoundationalSkillsLearnerCutRow[],
): Map<number, FoundationalSkillsLearnerCutRow[]> {
  const out = new Map<number, FoundationalSkillsLearnerCutRow[]>();
  for (const r of rows) {
    const list = out.get(r.userId);
    if (list) list.push(r);
    else out.set(r.userId, [r]);
  }
  return out;
}

const SLICE = `${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character`;

/**
 * Helping skills over time (Highlights → Helping skills): how long practice
 * takes to reach every basic behaviour of a tier (AAQ-205), whether learners
 * keep their level across a break (AAQ-206), and whether they move on to
 * harder scenarios as they practise (AAQ-207).
 *
 * The scored slices come from {@link FoundationalSkillsAnalyticsRepository.getAllLearnerCuts}
 * — the same read, the same rubric pin and the same org scope as the rest of
 * the tab — so a learner counted here is a learner counted there. All three are
 * all-time; with no data they return empty curves and zero counts, never 404.
 */
@Injectable()
export class FoundationalSkillsEffectivenessService {
  constructor(
    private readonly cuts: FoundationalSkillsAnalyticsRepository,
    private readonly repository: FoundationalSkillsEffectivenessRepository,
  ) {}

  async getTimeToCompetence(
    query: FoundationalSkillsEffectivenessQueryDto = {},
  ): Promise<TimeToCompetenceResponseDto> {
    const rows = await this.cuts.getAllLearnerCuts(
      FHS_RUBRIC_VERSION,
      query.tenantId,
    );
    const learners = [...byLearner(rows)].map(([userId, list]) => ({
      userId,
      cuts: list.map((r) => ({ cut: r.cut, levels: r.levels })),
    }));
    const minutes = await this.repository.getPracticeMinutesToCuts(
      competenceReaches(learners),
      query.tenantId,
    );
    const result = computeTimeToCompetence(learners, {
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
      minCohort: MIN_COHORT_SIZE,
      minutes,
    });
    const rule = (['engage', 'understand', 'support'] as const)
      .map(
        (t) =>
          `${t[0].toUpperCase()}${t.slice(1)} ${TIER_COMPETENCE_SKILLS[t]} of ${tierCompetenceSkillKeys(t).length}`,
      )
      .join(', ');
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      cutSizeLearnerChars: FHS_CUT_LEARNER_CHARS,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      competenceLevel: FHS_COMPETENCE_LEVEL,
      tierCompetenceSkills: { ...TIER_COMPETENCE_SKILLS },
      excludedSkills: TIER_COMPETENCE_EXCLUDED_SKILLS.map((skill) => ({
        skill,
        reason: TIER_COMPETENCE_EXCLUSION_REASONS[skill],
      })),
      ...result,
      scoping: scoping(query.tenantId),
      provenance: {
        derivation:
          `Helping-skills slices (R1): each learner's roleplay speech is cut into ${SLICE} slices, ` +
          `each scored 1–4 per skill by ${FHS_JUDGE_MODEL} on the fixed foundational helping skills ` +
          `rubric (3 = every basic behaviour, no unhelpful one). A learner reaches a tier at the first ` +
          `slice by which every movable skill but one has scored 3+ at least once (${rule}); rapport ` +
          `and family (capped at 2 by the rubric) and confidentiality and harm (rarely assessable) are ` +
          `left out, as the Helping skills tab marks them not measurable. The curve is ` +
          `Kaplan–Meier: the share reached by slice k among learners still practising, so someone who ` +
          `stopped early leaves the count rather than counting as "never". Minutes = their completed ` +
          `practice time up to the session that slice closed in.`,
        note:
          `"Reached" is a one-time crossing, not sustained: a later slice below 3 does not undo it. A ` +
          `skill a slice gave no opportunity for is not a miss, but it cannot be reached either, which is ` +
          `why one counted skill per tier is let off and why the card names the skill most often missing. ` +
          `Learners enter at their first slice; shares over ` +
          `fewer than ${MIN_SCORE_SAMPLE_SIZE} still at risk are withheld. Median minutes are among those ` +
          `who got there, not everyone. AI judge not yet checked against human raters; rubric ` +
          `${FHS_RUBRIC_VERSION}; all time; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }

  async getRetention(
    query: FoundationalSkillsEffectivenessQueryDto = {},
  ): Promise<SkillRetentionResponseDto> {
    const rows = await this.cuts.getAllLearnerCuts(
      FHS_RUBRIC_VERSION,
      query.tenantId,
    );
    const times = await this.repository.getSessionTimes(
      rows.flatMap((r) => r.sessionIds),
    );
    const learners = [...byLearner(rows)].map(([userId, list]) => ({
      userId,
      cuts: list.map((r) => ({
        cut: r.cut,
        score: r.score,
        unhelpful: r.unhelpful,
        sessionIds: r.sessionIds,
      })),
    }));
    const result = computeRetention(learners, times, {
      minPairs: MIN_SCORE_SAMPLE_SIZE,
      minLearners: RETENTION_MIN_LEARNERS,
    });
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      cutSizeLearnerChars: FHS_CUT_LEARNER_CHARS,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minPairs: MIN_SCORE_SAMPLE_SIZE,
      minLearners: RETENTION_MIN_LEARNERS,
      bandDefs: RETENTION_GAP_BANDS.map((b) => ({ ...b })),
      ...result,
      scoping: scoping(query.tenantId),
      provenance: {
        derivation:
          `Helping-skills slices (R1) and session times: for each learner's consecutive scored ${SLICE} ` +
          `slices k → k+1, the gap is from the end of the last session in slice k to the start of the ` +
          `first session in slice k+1 that slice k did not already contain. Change = composite (1–4) at ` +
          `k+1 minus at k, scored by ${FHS_JUDGE_MODEL}; each learner's pairs in a band are averaged ` +
          `first, then a paired bootstrap 95% interval is taken over learners. Under 7 days is the ` +
          `"no break" reference.`,
        note:
          `Associated with a break, not caused by it: learners choose when to stop, and those who come ` +
          `back after a month may differ from those who never left. Read a band against the under-7-days ` +
          `reference, not against zero — slice-to-slice change is noisy whatever the gap. A band is ` +
          `withheld below ${MIN_SCORE_SAMPLE_SIZE} pairs from ${RETENTION_MIN_LEARNERS}+ learners; pairs ` +
          `inside one session or without session times are counted, not plotted. AI judge not yet ` +
          `checked against human raters; rubric ${FHS_RUBRIC_VERSION}; all time; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }

  async getPracticeProgression(
    query: FoundationalSkillsEffectivenessQueryDto = {},
  ): Promise<PracticeProgressionResponseDto> {
    const rows = await this.repository.getPracticeOrdinals(
      PRACTICE_PROGRESSION_MAX_ORDINAL,
      query.tenantId,
    );
    const result = buildPracticeProgression(rows, {
      maxOrdinal: PRACTICE_PROGRESSION_MAX_ORDINAL,
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
    });
    return {
      maxOrdinal: PRACTICE_PROGRESSION_MAX_ORDINAL,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      experiencedMinSessions: PRACTICE_PROGRESSION_MAX_ORDINAL,
      levels: [...PRACTICE_DIFFICULTY_LEVELS],
      ...result,
      scoping: scoping(query.tenantId),
      provenance: {
        derivation:
          `Session counts, no learner score (none of R1–R10): each learner's completed roleplays in ` +
          `real rooms (no previews, seed rooms or AI-vs-AI test runs), numbered 1, 2, 3… by start time, ` +
          `split by the scenario's difficulty label. "Experienced" holds the learners with ` +
          `${PRACTICE_PROGRESSION_MAX_ORDINAL}+ sessions fixed across every ordinal.`,
        note:
          `Difficulty is an authoring label on the scenario (its current value), not a measured ` +
          `property, and new scenarios default to MEDIUM — so MEDIUM includes scenarios nobody labelled. ` +
          `Later ordinals hold only learners who kept practising; compare with the experienced panel ` +
          `before reading a drift as people moving up. Shares withheld below ${MIN_SCORE_SAMPLE_SIZE} ` +
          `sessions; all time; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }
}
