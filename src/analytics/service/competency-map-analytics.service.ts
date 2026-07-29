import { Injectable } from '@nestjs/common';

import {
  CompetencyMapQueryDto,
  CompetencyMapResponseDto,
  CompetencyMapRowDto,
} from '../dto/competency-map-analytics.dto';
import {
  CompetencyMapAnalyticsRepository,
  UNATTRIBUTED_COMPETENCY_LABEL,
} from '../repository/competency-map-analytics.repository';
// One floor for every judged score on the platform — see the constant's doc.
// A local copy here is how two charts on one tab end up suppressing at different
// sample sizes.
import { MIN_SCORE_SAMPLE_SIZE } from '../repository/quality-distribution-analytics.repository';

/** Score axis. Fixed so a nine-point spread cannot read as a chasm. */
const SCORE_DOMAIN: [number, number] = [0, 100];

/**
 * The practice-volume vs. score map for the leadership Highlights tab.
 *
 * Thin by design — the repository answers the question over one definition of an
 * attributed session. Two rules live here because both are places a client could
 * answer differently:
 *
 *  - **A thin row keeps its volume and loses its score.** Below
 *    {@link MIN_SCORE_SAMPLE_SIZE} evaluated sessions the median is null and
 *    `belowFloor` is set, but the row travels: dropping it would take its
 *    practice volume off the volume axis too, and "this competency is barely
 *    judged" is one of the findings the map exists to surface.
 *  - **The floor is decided once, and the flag is derived from the same
 *    comparison that nulls the score.** A client computing `belowFloor` itself
 *    could badge a row whose score is present, or leave a null score unexplained.
 */
@Injectable()
export class CompetencyMapAnalyticsService {
  constructor(private readonly repository: CompetencyMapAnalyticsRepository) {}

  async getCompetencyMap(
    query: CompetencyMapQueryDto,
  ): Promise<CompetencyMapResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const result = await this.repository.getCompetencyMap(tenantId);

    const competencies: CompetencyMapRowDto[] = result.rows.map((r) => {
      const belowFloor = r.evaluatedSessions < MIN_SCORE_SAMPLE_SIZE;
      return {
        competencyId: r.competencyId,
        name: r.name,
        completedSessions: r.completedSessions,
        evaluatedSessions: r.evaluatedSessions,
        medianScore: belowFloor ? null : r.medianScore,
        learners: r.learners,
        scenarios: r.scenarios,
        belowFloor,
      };
    });

    return {
      competencies,
      unattributed: {
        completedSessions: result.unattributed.completedSessions,
        evaluatedSessions: result.unattributed.evaluatedSessions,
        label: UNATTRIBUTED_COMPETENCY_LABEL,
      },
      minSampleSize: MIN_SCORE_SAMPLE_SIZE,
      scoreDomain: SCORE_DOMAIN,
      summary: {
        competencies: competencies.length,
        // DISTINCT sessions, not the sum of the rows above: a session on a
        // multi-competency scenario is one session here and one row per
        // competency there. The DTO declares the difference rather than letting
        // a reader discover the parts exceed the whole.
        completedSessions: result.totals.completedSessions,
        evaluatedSessions: result.totals.evaluatedSessions,
      },
      // The sessions carry a tenant, and the competencies and scenarios they
      // point at are platform objects — nothing here has to stay platform-wide
      // under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
