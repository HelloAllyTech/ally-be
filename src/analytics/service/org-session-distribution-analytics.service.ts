import { Injectable } from '@nestjs/common';
import {
  OrgDistributionSectionDto,
  OrgSessionDistributionQueryDto,
  OrgSessionDistributionResponseDto,
} from '../dto/org-session-distribution-analytics.dto';
import { MIN_ORG_GROUP_SIZE } from '../repository/highlights-analytics.repository';
import {
  ORG_AVG_MINUTES_BANDS,
  ORG_AVG_SESSIONS_BANDS,
  OrgDistributionResult,
  OrgSessionDistributionAnalyticsRepository,
} from '../repository/org-session-distribution-analytics.repository';

@Injectable()
export class OrgSessionDistributionAnalyticsService {
  constructor(
    private readonly repository: OrgSessionDistributionAnalyticsRepository,
  ) {}

  async getDistribution(
    query: OrgSessionDistributionQueryDto,
  ): Promise<OrgSessionDistributionResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const [timeResult, frequencyResult] = await Promise.all([
      this.repository.getTimeDistribution(tenantId),
      this.repository.getFrequencyDistribution(tenantId),
    ]);

    return {
      avgMinutesPerLearner: this.toSection(
        timeResult,
        ORG_AVG_MINUTES_BANDS.map((b) => b.label),
      ),
      avgSessionsPerLearner: this.toSection(
        frequencyResult,
        ORG_AVG_SESSIONS_BANDS.map((b) => b.label),
      ),
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Below {@link MIN_ORG_GROUP_SIZE} orgs, a band count of e.g. "1" over a
   * population of 2 both leaks which org that is and says nothing generalisable
   * — so the whole distribution is withheld rather than shown thin, the same
   * floor `HighlightsAnalyticsRepository`/`OrgHealthAnalyticsService` already
   * apply to every other per-org breakdown.
   */
  private toSection(
    result: OrgDistributionResult,
    labels: string[],
  ): OrgDistributionSectionDto {
    const shown = result.totalOrgs >= MIN_ORG_GROUP_SIZE;
    return {
      totalOrgs: result.totalOrgs,
      bands: shown
        ? labels.map((label, i) => ({ label, orgs: result.orgsByBand[i] ?? 0 }))
        : [],
      minGroupSize: MIN_ORG_GROUP_SIZE,
      shown,
    };
  }
}
