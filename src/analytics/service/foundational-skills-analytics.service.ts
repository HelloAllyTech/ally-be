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
  FoundationalSkillsProgressQueryDto,
  FoundationalSkillsProgressResponseDto,
  FoundationalSkillsBehavioursQueryDto,
  FoundationalSkillsBehavioursResponseDto,
  FoundationalSkillsQueryDto,
  FoundationalSkillsResponseDto,
} from '../dto/foundational-skills-analytics.dto';
import { MIN_COHORT_SIZE } from '../repository/cohort-analytics.repository';
import {
  FoundationalSkillsAnalyticsRepository,
  FoundationalSkillsLearnerCutRow,
} from '../repository/foundational-skills-analytics.repository';
import {
  FHS_PROGRESS_THRESHOLDS,
  ProgressLearner,
  computeProgress,
  countLevelMismatches,
} from '../util/foundational-skills-progress.util';
import { deriveLevel } from 'src/foundational-skills/util/skill-scoring.util';
import {
  FHS_BEHAVIOUR_THRESHOLDS,
  computeBehaviourRates,
} from '../util/foundational-skills-behaviour.util';
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

  async getFoundationalSkills(
    query: FoundationalSkillsQueryDto = {},
  ): Promise<FoundationalSkillsResponseDto> {
    const baselineCut = query.baselineCut === 2 ? 2 : 1;
    const [cutRows, skillRows, coverage] = await Promise.all([
      this.repository.getCutRows(FHS_RUBRIC_VERSION, baselineCut),
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
        pairedChangeCi:
          row.baselineLearners >= MIN_SCORE_SAMPLE_SIZE &&
          row.pairedChange !== null &&
          row.pairedChangeSd !== null
            ? normalCi(
                row.pairedChange,
                row.pairedChangeSd,
                row.baselineLearners,
              )
            : null,
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
      baselineCut,
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
          `"same learners' cut ${baselineCut}" line, not with the first point — and read the ` +
          `change against its 95% interval: one whose interval includes zero is not ` +
          `distinguishable from noise. AI-judged; not yet checked against trained human raters.`,
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
      { minCut, limit, offset, userId: query.userId },
    );

    const scenarios = await this.repository.getSessionScenarios([
      ...new Set(rows.flatMap((r) => r.sessionIds)),
    ]);

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
        sessions: row.sessionIds.map((sessionId) => ({
          sessionId,
          scenarioId: scenarios.get(sessionId)?.scenarioId ?? null,
          scenarioTitle: scenarios.get(sessionId)?.scenarioTitle ?? null,
        })),
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

  /**
   * Everything the Skills sub-tab draws: which skills and behaviours move with
   * practice, and for whom, over one balanced panel of learners. The rules live
   * in `foundational-skills-progress.util`; this method only loads, groups and
   * labels. Same floors as the AAQ-166 chart: averages and shares are withheld
   * below {@link MIN_SCORE_SAMPLE_SIZE} learners while counts travel, and a
   * panel is only offered with at least {@link MIN_COHORT_SIZE}.
   */
  async getProgress(
    query: FoundationalSkillsProgressQueryDto,
  ): Promise<FoundationalSkillsProgressResponseDto> {
    const rows = await this.repository.getAllLearnerCuts(FHS_RUBRIC_VERSION);
    const learners = groupByLearner(rows);
    const rubricByKey = new Map(FHS_RUBRIC.map((sk) => [sk.key, sk]));
    const levelChecks = countLevelMismatches(
      rows.map((r) => r.verdicts),
      (skill, observed, notApplicable) => {
        const def = rubricByKey.get(skill);
        return def ? deriveLevel(def, observed, notApplicable) : null;
      },
    );
    const result = computeProgress(learners, {
      requestedCuts: query.cuts,
      baselineFrom: query.baselineFrom === 2 ? 2 : 1,
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
      minCohort: MIN_COHORT_SIZE,
      levelChecks,
    });
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      cutSizeLearnerChars: FHS_CUT_LEARNER_CHARS,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      minCohortSize: MIN_COHORT_SIZE,
      scoreDomain: [1, 4],
      thresholds: { ...FHS_PROGRESS_THRESHOLDS },
      measuredLearners: learners.length,
      ...result,
      provenance: {
        derivation:
          `Each learner's roleplay speech is cut into ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
          `slices and every slice is scored by ${FHS_JUDGE_MODEL} against the fixed foundational helping ` +
          `skills rubric (1 = an unhelpful behaviour, 2 = not every basic behaviour, 3 = every basic, ` +
          `4 = basic plus advanced). A skill the slice gave no opportunity for is skipped, never scored low.`,
        note:
          `"Start" and "now" compare the SAME learners: those whose first ${result.cuts} cuts are all scored, ` +
          `start = mean of cuts ${result.windows.early.join(', ')}, now = mean of cuts ` +
          `${result.windows.late.join(', ')}. Every change carries a paired bootstrap 95% CI and an exact ` +
          `sign test, and is called a move only when the CI excludes zero. Averages and shares over fewer ` +
          `than ${MIN_SCORE_SAMPLE_SIZE} learners are withheld. Scores come from an AI judge not yet checked ` +
          `against trained human raters: practice feedback, not a clinical assessment. Rubric ` +
          `${FHS_RUBRIC_VERSION}; test organisations excluded.`,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Behaviour rates ("habits"): how often each learner shows each rubric
   * behaviour where they had the chance, how person-specific each behaviour is,
   * and own start vs now — per group (BH-corrected) and per learner (Fisher).
   * The production quick test found behaviours carry 4–15× the person signal
   * of the 1–4 levels, so this is the measure the Helping skills tab leads with.
   * Built from stored behaviour codes: no re-scoring, no model calls.
   */
  async getBehaviours(
    query: FoundationalSkillsBehavioursQueryDto,
  ): Promise<FoundationalSkillsBehavioursResponseDto> {
    const rows = await this.repository.getAllLearnerCuts(FHS_RUBRIC_VERSION);
    const result = computeBehaviourRates(groupByLearner(rows), {
      sampleFloor: MIN_SCORE_SAMPLE_SIZE,
      userId: query.userId,
    });
    return {
      rubricVersion: FHS_RUBRIC_VERSION,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      thresholds: { ...FHS_BEHAVIOUR_THRESHOLDS },
      ...result,
      provenance: {
        derivation:
          `A behaviour's rate is the share of a learner's ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
          `slices in which the judge saw it, among the slices where its skill could be shown at all. ` +
          `Every credited behaviour is backed by a quote found in the transcript.`,
        note:
          `Own start vs now compares a learner's first half of slices with their last half ` +
          `(${FHS_BEHAVIOUR_THRESHOLDS.minCuts}+ slices). Group changes carry a bootstrap 95% CI and are ` +
          `credible only after a Benjamini–Hochberg correction across every behaviour; one learner's change ` +
          `is clear only at Fisher p ≤ ${FHS_BEHAVIOUR_THRESHOLDS.learnerP}. "Trackable" = ICC ≥ ` +
          `${FHS_BEHAVIOUR_THRESHOLDS.trackableIcc}: the behaviour says something about the person rather than ` +
          `the slice. AI-judged; not yet checked against trained human raters.`,
      },
      computedAt: new Date().toISOString(),
    };
  }
}

/** Rows arrive ordered by user then cut; fold them into one series per learner. */
function groupByLearner(
  rows: readonly FoundationalSkillsLearnerCutRow[],
): ProgressLearner[] {
  const byUser = new Map<number, ProgressLearner>();
  for (const row of rows) {
    let learner = byUser.get(row.userId);
    if (!learner) {
      learner = {
        userId: row.userId,
        name: row.name,
        tenantId: row.tenantId,
        cuts: [],
      };
      byUser.set(row.userId, learner);
    }
    learner.tenantId = row.tenantId ?? learner.tenantId;
    learner.cuts.push({
      cut: row.cut,
      score: row.score,
      unhelpful: row.unhelpful,
      levels: row.levels,
      observed: new Set(row.verdicts.flatMap((v) => v.observed ?? [])),
    });
  }
  for (const learner of byUser.values()) {
    learner.cuts.sort((a, b) => a.cut - b.cut);
  }
  return [...byUser.values()];
}

/** Normal-approximation 95% CI of a mean change from its SD and n (2dp). */
function normalCi(mean: number, sd: number, n: number): [number, number] {
  const half = (1.96 * sd) / Math.sqrt(n);
  return [
    Math.round((mean - half) * 100) / 100,
    Math.round((mean + half) * 100) / 100,
  ];
}
