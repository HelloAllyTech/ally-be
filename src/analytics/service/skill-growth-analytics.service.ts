import { Injectable, NotFoundException } from '@nestjs/common';

import {
  SkillGrowthCellDto,
  SkillGrowthLearnerSeriesResponseDto,
  SkillGrowthLearnersQueryDto,
  SkillGrowthLearnersResponseDto,
  SkillGrowthOrdinalDto,
  SkillGrowthQueryDto,
  SkillGrowthResponseDto,
  SkillTrendThresholdsDto,
} from '../dto/skill-growth-analytics.dto';
// The score floor lives with the quality repository because it is one floor for
// every judged score on the platform, not a per-chart setting. Importing it is
// deliberate: a local copy here is how a chart ends up suppressing at a different
// n than the one beside it.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  SKILL_GROWTH_DERIVATION,
  SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
  SKILL_GROWTH_LEARNER_SESSION_CAP,
  SKILL_GROWTH_MAX_ORDINAL,
  SKILL_GROWTH_PROVENANCE_NOTE,
  SKILL_TREND_FLAT_BAND,
  SKILL_TREND_MIN_SESSIONS,
  SKILL_TREND_WINDOW,
  SkillGrowthAnalyticsRepository,
  SkillGrowthCell,
  SkillGrowthLearnerSession,
  SkillGrowthOrdinalRow,
  SkillTrendClass,
} from '../repository/skill-growth-analytics.repository';

/** Score axis. Fixed so a nine-point wobble cannot fill the chart. */
const SCORE_DOMAIN: [number, number] = [0, 100];

/** An ordinal nobody reached: the axis tick exists, the measurement does not. */
const EMPTY_CELL: SkillGrowthCell = {
  median: null,
  p25: null,
  p75: null,
  n: 0,
};

/**
 * The learning curve for the leadership Highlights tab.
 *
 * Thin by design — the repository answers the question in one pass. Three rules
 * live here because each is a place a client could otherwise answer differently:
 *
 *  - **The sample floor is applied server-side, and `n` survives it.** A cell
 *    below {@link MIN_SCORE_SAMPLE_SIZE} comes back with null percentiles and its
 *    real count, so the surface can say "n = 4 · need 20". Leaving the
 *    suppression to the client means every client re-implements it, and one of
 *    them eventually draws the line anyway.
 *  - **The ordinal axis is completed to `maxOrdinal`, the measurements are not.**
 *    An ordinal nobody has reached is emitted with `n: 0` and null percentiles.
 *    This is not gap-filling an average with zero — a count of zero sessions is a
 *    fact, and the percentiles stay null precisely because a median of no
 *    observations is not a median of zero. It buys the chart a stable x-axis that
 *    does not change length as the platform grows.
 *  - **"Where does the line stop being worth reading" is computed once.** The
 *    headline pairs ordinal 1 against the LAST ordinal that clears the floor, so
 *    the claim on the card is bounded by the data rather than by whichever point
 *    the axis happens to end on.
 */
@Injectable()
export class SkillGrowthAnalyticsService {
  constructor(private readonly repository: SkillGrowthAnalyticsRepository) {}

  async getSkillGrowth(
    query: SkillGrowthQueryDto,
  ): Promise<SkillGrowthResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const [distribution, trendMix] = await Promise.all([
      this.repository.getOrdinalDistribution(tenantId),
      this.repository.getTrendMix(tenantId),
    ]);

    const byOrdinal = new Map<number, SkillGrowthOrdinalRow>(
      distribution.ordinals.map((r) => [r.ordinal, r]),
    );

    const ordinals: SkillGrowthOrdinalDto[] = [];
    for (let ordinal = 1; ordinal <= SKILL_GROWTH_MAX_ORDINAL; ordinal += 1) {
      const row = byOrdinal.get(ordinal);
      ordinals.push({
        ordinal,
        all: this.applyFloor(row?.all ?? EMPTY_CELL),
        experienced: this.applyFloor(row?.experienced ?? EMPTY_CELL),
      });
    }

    // The last ordinal whose "all" sample clears the floor — read off the
    // suppressed cells so the summary and the chart can never disagree about
    // where the credible part of the line ends.
    const comparable = ordinals.filter((o) => o.all.median !== null);
    const last = comparable.length ? comparable[comparable.length - 1] : null;

    return {
      ordinals,
      maxOrdinal: SKILL_GROWTH_MAX_ORDINAL,
      experiencedMinSessions: SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: SCORE_DOMAIN,
      provenance: {
        derivation: SKILL_GROWTH_DERIVATION,
        note: SKILL_GROWTH_PROVENANCE_NOTE,
      },
      summary: {
        learners: distribution.learners,
        experiencedLearners: distribution.experiencedLearners,
        evaluatedSessions: distribution.evaluatedSessions,
        firstOrdinalMedian: ordinals[0]?.all.median ?? null,
        lastComparableOrdinal: last?.ordinal ?? null,
        lastComparableMedian: last?.all.median ?? null,
      },
      trendMix: { ...trendMix, thresholds: this.thresholds() },
      // The sessions carry a tenant, so unlike AI cost or org counts there is
      // nothing here that has to stay platform-wide under a filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /** One page of learners with their own-baseline trend, for the drill-down. */
  async getLearnerTrends(
    query: SkillGrowthLearnersQueryDto,
  ): Promise<SkillGrowthLearnersResponseDto> {
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const page = await this.repository.getLearnerTrendPage({
      tenantId: query.tenantId?.trim() || undefined,
      limit,
      offset,
      sort: query.sort ?? 'delta',
      descending: (query.order ?? 'desc') === 'desc',
    });

    return {
      rows: page.rows,
      total: page.total,
      limit,
      offset,
      thresholds: this.thresholds(),
      provenance: {
        derivation: SKILL_GROWTH_DERIVATION,
        note: SKILL_GROWTH_PROVENANCE_NOTE,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * One learner's full timeline: roleplay and knowledge series side by side.
   *
   * 404s on an unknown user id, but an existing learner with NO evaluated
   * sessions is a valid answer with empty series — a drill-down reached from
   * the list can race an admin deleting sessions, and "this learner has no
   * judged sessions" is information where an error would read as a bug.
   *
   * The trend classification is recomputed here from the same constants the
   * list used, so the header a drill-down shows can never disagree with the
   * row that was clicked.
   */
  async getLearnerSeries(
    learnerId: number,
  ): Promise<SkillGrowthLearnerSeriesResponseDto> {
    const identity = await this.repository.getLearnerIdentity(learnerId);
    if (!identity) {
      throw new NotFoundException(`No user with id ${learnerId}`);
    }

    const [sessions, knowledgeAttempts] = await Promise.all([
      this.repository.getLearnerSessions(learnerId),
      this.repository.getLearnerKnowledgeAttempts(learnerId),
    ]);

    return {
      learner: { ...identity, ...this.classify(sessions) },
      sessions,
      knowledgeAttempts,
      truncated:
        sessions.length >= SKILL_GROWTH_LEARNER_SESSION_CAP ||
        knowledgeAttempts.length >= SKILL_GROWTH_LEARNER_SESSION_CAP,
      thresholds: this.thresholds(),
      scoreDomain: SCORE_DOMAIN,
      provenance: {
        derivation: SKILL_GROWTH_DERIVATION,
        note: SKILL_GROWTH_PROVENANCE_NOTE,
      },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * The same first-window/last-window classification the SQL applies, in JS —
   * for the one place that already holds the sessions and would otherwise run
   * a second aggregate query to learn what it can compute from them.
   */
  private classify(sessions: SkillGrowthLearnerSession[]): {
    evaluatedSessions: number;
    firstWindowMean: number | null;
    lastWindowMean: number | null;
    delta: number | null;
    trend: SkillTrendClass;
  } {
    const evaluatedSessions = sessions.length;
    if (evaluatedSessions < SKILL_TREND_MIN_SESSIONS) {
      return {
        evaluatedSessions,
        firstWindowMean: null,
        lastWindowMean: null,
        delta: null,
        trend: 'insufficient',
      };
    }
    const mean = (slice: SkillGrowthLearnerSession[]): number =>
      Math.round(
        (slice.reduce((sum, s) => sum + s.compositeScore, 0) / slice.length) *
          10,
      ) / 10;
    const firstWindowMean = mean(sessions.slice(0, SKILL_TREND_WINDOW));
    const lastWindowMean = mean(sessions.slice(-SKILL_TREND_WINDOW));
    const delta = Math.round((lastWindowMean - firstWindowMean) * 10) / 10;
    const trend: SkillTrendClass =
      delta > SKILL_TREND_FLAT_BAND
        ? 'improving'
        : delta < -SKILL_TREND_FLAT_BAND
          ? 'declining'
          : 'flat';
    return { evaluatedSessions, firstWindowMean, lastWindowMean, delta, trend };
  }

  private thresholds(): SkillTrendThresholdsDto {
    return {
      minSessions: SKILL_TREND_MIN_SESSIONS,
      window: SKILL_TREND_WINDOW,
      flatBand: SKILL_TREND_FLAT_BAND,
    };
  }

  /**
   * Drop the percentiles of a thin cell; never drop its count.
   *
   * The count is what turns a blank cell from an apparent bug into a stated
   * limitation, so it is the one field that always survives.
   */
  private applyFloor(cell: SkillGrowthCell): SkillGrowthCellDto {
    if (cell.n < MIN_SCORE_SAMPLE_SIZE) {
      return { median: null, p25: null, p75: null, n: cell.n };
    }
    return { median: cell.median, p25: cell.p25, p75: cell.p75, n: cell.n };
  }
}
