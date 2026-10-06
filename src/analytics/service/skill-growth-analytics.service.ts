import { Injectable, NotFoundException } from '@nestjs/common';

import {
  FHS_CUT_LEARNER_CHARS,
  FHS_JUDGE_MODEL,
  FHS_RUBRIC_VERSION,
} from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import {
  SkillGrowthLearnerSeriesResponseDto,
  SkillGrowthLearnerSessionDto,
  SkillGrowthLearnersQueryDto,
  SkillGrowthLearnersResponseDto,
  SkillGrowthQueryDto,
  SkillGrowthResponseDto,
  SkillTrendLearnerRowDto,
} from '../dto/skill-growth-analytics.dto';
import { FoundationalSkillsAnalyticsRepository } from '../repository/foundational-skills-analytics.repository';
// The score floor lives with the quality repository because it is one floor for
// every judged score on the platform, not a per-chart setting. Importing it is
// deliberate: a local copy here is how a chart ends up suppressing at a different
// n than the one beside it.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import { SkillGrowthAnalyticsRepository } from '../repository/skill-growth-analytics.repository';
import { cutNoiseSd } from '../util/foundational-skills-progress.util';
import {
  SKILL_GROWTH_EXPERIENCED_MIN_CUTS,
  SKILL_GROWTH_LEARNER_ROW_CAP,
  SKILL_GROWTH_MAX_ORDINAL,
  SkillGrowthClassification,
  SkillGrowthLearner,
  buildSkillGrowthCurve,
  buildSkillTrendMix,
  classifySkillGrowthLearner,
  cutScenarioTitle,
  skillTrendThresholds,
  sortSkillGrowthLearners,
  toSkillGrowthLearners,
} from '../util/skill-growth.util';

/** The rubric's level scale — the axis every cut composite lives on. */
const SCORE_DOMAIN: [number, number] = [1, 4];

/** Quiz/annotation `scorePct` — the knowledge series' own axis. */
const KNOWLEDGE_SCORE_DOMAIN: [number, number] = [0, 100];

/**
 * What the curve measures (ruler R1), echoed on the card.
 *
 * Constants only, no module-load work beyond string assembly.
 */
export const SKILL_GROWTH_DERIVATION =
  `Learner ruler R1 (foundational helping skills). Each learner's completed roleplay ` +
  `practice, in the order it ended, is cut into ${FHS_CUT_LEARNER_CHARS.toLocaleString('en')}-character ` +
  `slices of their OWN speech; every slice is scored by ${FHS_JUDGE_MODEL} against the fixed ` +
  `foundational helping skills rubric (14 of 15 skills; non-verbal is not visible in a ` +
  `transcript), a skill only where the slice gave an opportunity for it. The composite is the ` +
  `mean of the scored skills, 1–4. Ordinal N is the learner's Nth slice, the same amount of ` +
  `practice for everyone.`;

export const SKILL_GROWTH_PROVENANCE_NOTE =
  `AI-judged and not yet checked against trained human raters: practice feedback, not a ` +
  `clinical assessment. Only slices scored under rubric ${FHS_RUBRIC_VERSION} are used — a new ` +
  `version re-scores every slice rather than mixing rulers. A slice can span several ` +
  `scenarios. Test organisations excluded. Until October 2026 this chart plotted a different ` +
  `number — the AI judge's 0–100 score of the AI roleplay character, not of the learner — so ` +
  `it cannot be compared with earlier screenshots.`;

const provenance = () => ({
  derivation: SKILL_GROWTH_DERIVATION,
  note: SKILL_GROWTH_PROVENANCE_NOTE,
});

/**
 * Highlights → Skill growth, on the learner ruler.
 *
 * Every number here is computed from ONE read: the scored foundational-skills
 * cuts from `FoundationalSkillsAnalyticsRepository.getAllLearnerCuts`, the
 * same rows the Helping skills sub-tab is built from. The arithmetic lives in
 * `util/skill-growth.util.ts`; this service loads, groups and labels. Three
 * rules live here because each is a place a client could otherwise answer
 * differently:
 *
 *  - **The sample floor is applied server-side, and `n` survives it.** A cell
 *    below {@link MIN_SCORE_SAMPLE_SIZE} comes back with null percentiles and
 *    its real count, so the surface can say "n = 4 · need 20".
 *  - **The noise estimate is taken over the population being classified.**
 *    `cutNoiseSd` of the learners in scope, exactly as `computeProgress` does
 *    for the Helping skills tab, so an org-filtered trend mix here and there
 *    classify the same learners the same way.
 *  - **The drill-down is platform-wide and classifies against the
 *    platform-wide noise**, which is what the unfiltered list shows. It reads
 *    every scored cut for that, as the Helping skills tab does on every
 *    request — fine at today's hundreds of cuts.
 */
@Injectable()
export class SkillGrowthAnalyticsService {
  constructor(
    private readonly repository: SkillGrowthAnalyticsRepository,
    private readonly cuts: FoundationalSkillsAnalyticsRepository,
  ) {}

  async getSkillGrowth(
    query: SkillGrowthQueryDto,
  ): Promise<SkillGrowthResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const learners = await this.loadLearners(tenantId);
    const noise = cutNoiseSd(learners);

    const curve = buildSkillGrowthCurve(learners, MIN_SCORE_SAMPLE_SIZE);
    const trendMix = buildSkillTrendMix(
      learners.map((l) => classifySkillGrowthLearner(l, noise)),
    );

    return {
      ordinals: curve.ordinals,
      maxOrdinal: SKILL_GROWTH_MAX_ORDINAL,
      experiencedMinSessions: SKILL_GROWTH_EXPERIENCED_MIN_CUTS,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: SCORE_DOMAIN,
      rubricVersion: FHS_RUBRIC_VERSION,
      cutSizeLearnerChars: FHS_CUT_LEARNER_CHARS,
      provenance: provenance(),
      summary: {
        learners: curve.learners,
        experiencedLearners: curve.experiencedLearners,
        evaluatedSessions: curve.scoredCuts,
        firstOrdinalMedian: curve.firstOrdinalMedian,
        lastComparableOrdinal: curve.lastComparableOrdinal,
        lastComparableMedian: curve.lastComparableMedian,
      },
      trendMix: { ...trendMix, thresholds: skillTrendThresholds(noise) },
      // Every cut carries a tenant, so nothing here stays platform-wide
      // under a filter — the noise estimate included.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /** One page of learners with their own-baseline trend, for the drill-down. */
  async getLearnerTrends(
    query: SkillGrowthLearnersQueryDto,
  ): Promise<SkillGrowthLearnersResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const learners = await this.loadLearners(tenantId);
    const noise = cutNoiseSd(learners);
    const sorted = sortSkillGrowthLearners(
      learners.map((learner) => ({
        learner,
        classification: classifySkillGrowthLearner(learner, noise),
      })),
      query.sort ?? 'delta',
      (query.order ?? 'desc') === 'desc',
    );
    const page = sorted.slice(offset, offset + limit);

    const identities = new Map(
      (
        await this.repository.getLearnerIdentities(
          page.map((r) => r.learner.userId),
        )
      ).map((i) => [i.id, i]),
    );

    const rows: SkillTrendLearnerRowDto[] = page.map(
      ({ learner, classification }) => {
        const identity = identities.get(learner.userId);
        return {
          learnerId: learner.userId,
          name: identity?.name ?? learner.name,
          email: identity?.email ?? null,
          tenantId: identity?.tenantId ?? learner.tenantId,
          ...this.trendFields(classification),
          lastSessionAt: classification.lastCutAt?.toISOString() ?? null,
        };
      },
    );

    return {
      rows,
      total: sorted.length,
      limit,
      offset,
      thresholds: skillTrendThresholds(noise),
      rubricVersion: FHS_RUBRIC_VERSION,
      provenance: provenance(),
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * One learner's full timeline: their scored cuts and their knowledge
   * attempts, side by side.
   *
   * 404s on an unknown user id, but an existing learner with NO scored cuts
   * is a valid answer with empty series — "no scored practice yet" is
   * information where an error would read as a bug.
   */
  async getLearnerSeries(
    learnerId: number,
  ): Promise<SkillGrowthLearnerSeriesResponseDto> {
    const identity = await this.repository.getLearnerIdentity(learnerId);
    if (!identity) {
      throw new NotFoundException(`No user with id ${learnerId}`);
    }

    const [learners, knowledgeAttempts] = await Promise.all([
      this.loadLearners(undefined),
      this.repository.getLearnerKnowledgeAttempts(learnerId),
    ]);
    const noise = cutNoiseSd(learners);
    const learner: SkillGrowthLearner = learners.find(
      (l) => l.userId === learnerId,
    ) ?? { userId: learnerId, name: identity.name, tenantId: null, cuts: [] };

    const shown = learner.cuts.slice(0, SKILL_GROWTH_LEARNER_ROW_CAP);
    const scenarios = await this.cuts.getSessionScenarios([
      ...new Set(shown.flatMap((c) => c.sessionIds)),
    ]);
    const sessions: SkillGrowthLearnerSessionDto[] = shown.map((c) => ({
      ordinal: c.cut,
      occurredAt: c.closedAt.toISOString(),
      scenarioTitle: cutScenarioTitle(c.sessionIds, scenarios),
      compositeScore: Math.round(c.score * 100) / 100,
      skillCoverage: null,
      skillLevels: c.levels,
      hasUnhelpfulBehaviour: c.unhelpful,
    }));

    return {
      learner: {
        ...identity,
        ...this.trendFields(classifySkillGrowthLearner(learner, noise)),
      },
      sessions,
      knowledgeAttempts,
      truncated:
        learner.cuts.length > SKILL_GROWTH_LEARNER_ROW_CAP ||
        knowledgeAttempts.length >= SKILL_GROWTH_LEARNER_ROW_CAP,
      thresholds: skillTrendThresholds(noise),
      scoreDomain: SCORE_DOMAIN,
      knowledgeScoreDomain: KNOWLEDGE_SCORE_DOMAIN,
      rubricVersion: FHS_RUBRIC_VERSION,
      provenance: provenance(),
      computedAt: new Date().toISOString(),
    };
  }

  /** The scored cuts in scope, folded one series per learner. */
  private async loadLearners(tenantId?: string): Promise<SkillGrowthLearner[]> {
    return toSkillGrowthLearners(
      await this.cuts.getAllLearnerCuts(FHS_RUBRIC_VERSION, tenantId),
    );
  }

  private trendFields(c: SkillGrowthClassification) {
    return {
      evaluatedSessions: c.scoredCuts,
      firstWindowMean: c.firstWindowMean,
      lastWindowMean: c.lastWindowMean,
      delta: c.delta,
      band: c.band,
      trend: c.trend,
    };
  }
}
