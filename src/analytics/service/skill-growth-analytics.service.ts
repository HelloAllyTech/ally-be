import { Injectable } from '@nestjs/common';

import {
  SkillGrowthCellDto,
  SkillGrowthOrdinalDto,
  SkillGrowthQueryDto,
  SkillGrowthResponseDto,
} from '../dto/skill-growth-analytics.dto';
// The score floor lives with the quality repository because it is one floor for
// every judged score on the platform, not a per-chart setting. Importing it is
// deliberate: a local copy here is how a chart ends up suppressing at a different
// n than the one beside it.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';
import {
  SKILL_GROWTH_DERIVATION,
  SKILL_GROWTH_EXPERIENCED_MIN_SESSIONS,
  SKILL_GROWTH_MAX_ORDINAL,
  SKILL_GROWTH_PROVENANCE_NOTE,
  SkillGrowthAnalyticsRepository,
  SkillGrowthCell,
  SkillGrowthOrdinalRow,
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

    const distribution = await this.repository.getOrdinalDistribution(tenantId);

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
      // The sessions carry a tenant, so unlike AI cost or org counts there is
      // nothing here that has to stay platform-wide under a filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
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
