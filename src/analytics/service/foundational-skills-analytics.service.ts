import { Injectable } from '@nestjs/common';

import {
  FHS_RUBRIC,
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  FoundationalSkillsCutDto,
  FoundationalSkillsLearnerDto,
  FoundationalSkillsLearnersQueryDto,
  FoundationalSkillsLearnersResponseDto,
  FoundationalSkillsResponseDto,
} from '../dto/foundational-skills-analytics.dto';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
// One floor for every judged score on the platform — see SkillGrowthAnalyticsService.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';

const round2 = (v: number | null): number | null =>
  v === null ? null : Math.round(v * 100) / 100;

/**
 * Foundational helping skills by practice volume, for the Priority tab.
 *
 * Two rules live here so no client can answer them differently:
 *
 *  - **The sample floor is applied server-side and `learners` survives it.** An
 *    average over fewer than {@link MIN_SCORE_SAMPLE_SIZE} learners comes back
 *    null with its real count, so the card can say "n = 12 · need 20" instead of
 *    drawing a point that one learner can swing.
 *  - **The axis ends at the last cut at least {@link MIN_COHORT_SIZE} learners
 *    reached.** Beyond it every cell would be a withheld average over one or two
 *    people; an axis that grows with the single most prolific learner says more
 *    about them than about the platform.
 */
@Injectable()
export class FoundationalSkillsAnalyticsService {
  constructor(
    private readonly repository: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getFoundationalSkills(): Promise<FoundationalSkillsResponseDto> {
    const [cutRows, skillRows, coverage] = await Promise.all([
      this.repository.getCutRows(FHS_RUBRIC_VERSION),
      this.repository.getSkillRows(FHS_RUBRIC_VERSION),
      this.repository.getCoverage(FHS_RUBRIC_VERSION),
    ]);

    const lastShown = cutRows.reduce(
      (last, row) => (row.learners >= MIN_COHORT_SIZE ? row.cut : last),
      0,
    );
    const floor = (n: number, v: number | null) =>
      n >= MIN_SCORE_SAMPLE_SIZE ? round2(v) : null;

    const cuts: FoundationalSkillsCutDto[] = cutRows
      .filter((row) => row.cut <= lastShown)
      .map((row) => ({
        cut: row.cut,
        learners: row.learners,
        avgScore: floor(row.learners, row.avgScore),
        baselineLearners: row.baselineLearners,
        pairedAvgScore: floor(row.baselineLearners, row.pairedAvgScore),
        baselineAvgScore: floor(row.baselineLearners, row.baselineAvgScore),
        pairedChange: floor(row.baselineLearners, row.pairedChange),
        unhelpfulPct:
          row.learners >= MIN_SCORE_SAMPLE_SIZE && row.unhelpfulShare !== null
            ? Math.round(row.unhelpfulShare * 1000) / 10
            : null,
        skills: skillRows
          .filter((s) => s.cut === row.cut)
          .map((s) => ({
            skill: s.skill,
            learners: s.learners,
            avgScore: floor(s.learners, s.avgScore),
          })),
      }));

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      cutSizeLearnerChars: FHS_CUT_LEARNER_CHARS,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: [1, 4],
      skills: FHS_RUBRIC.map((i) => ({
        skill: i.key,
        name: i.name,
        tier: i.tier,
      })),
      cuts,
      coverage,
      provenance: {
        derivation:
          `Each learner's completed roleplay practice, in the order it ended, is cut into ` +
          `${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character slices of their OWN speech. ` +
          `Each slice is scored by ${FHS_JUDGE_MODEL} against the fixed foundational helping skills rubric ` +
          `(14 of 15 foundational helping skills; non-verbal is not visible in a transcript). ` +
          `A skill is scored only when the slice gave an opportunity for it; the composite is the ` +
          `mean of the scored skills, 1–4.`,
        note:
          `Independent of every scenario's own competencies. Scores are comparable only within ` +
          `rubric version ${FHS_RUBRIC_VERSION}; a new version re-scores every slice. Later cuts ` +
          `contain only the learners who kept practising, so compare each point with its ` +
          `"same learners' first cut" line, not with the first point.`,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * The people behind a point on the chart, one row each with every scored
   * cut. No sample floor here — this is a drill-down to individuals, gated the
   * same as the skill-growth learner list, not an aggregate that one learner
   * could swing. Behaviour codes travel; transcript text and evidence quotes
   * are never stored, so they cannot leak.
   */
  async getLearners(
    query: FoundationalSkillsLearnersQueryDto,
  ): Promise<FoundationalSkillsLearnersResponseDto> {
    const minCut = query.minCut ?? 1;
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const { total, rows } = await this.repository.getLearnerCuts(
      FHS_RUBRIC_VERSION,
      minCut,
      limit,
      offset,
    );

    const byLearner = new Map<number, FoundationalSkillsLearnerDto>();
    for (const row of rows) {
      let learner = byLearner.get(row.userId);
      if (!learner) {
        learner = {
          id: row.userId,
          name: row.name,
          tenantId: row.tenantId,
          cutsReached: 0,
          changeSinceFirstCut: null,
          cuts: [],
        };
        byLearner.set(row.userId, learner);
      }
      learner.cuts.push({
        cut: row.cut,
        closedAt: row.closedAt.toISOString(),
        compositeScore: round2(row.score) as number,
        hasUnhelpfulBehaviour: row.unhelpful,
        skillLevels: row.levels,
        observed: [
          ...new Set(row.verdicts.flatMap((v) => v.observed ?? [])),
        ].sort(),
      });
      learner.cutsReached = Math.max(learner.cutsReached, row.cut);
      learner.tenantId = row.tenantId ?? learner.tenantId;
    }

    for (const learner of byLearner.values()) {
      const first = learner.cuts.find((c) => c.cut === 1);
      const last = learner.cuts[learner.cuts.length - 1];
      learner.changeSinceFirstCut =
        first && last
          ? round2(last.compositeScore - first.compositeScore)
          : null;
    }

    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minCut,
      total,
      limit,
      offset,
      learners: [...byLearner.values()],
      computedAt: new Date().toISOString(),
    };
  }
}
