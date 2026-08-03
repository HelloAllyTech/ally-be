import { Injectable } from '@nestjs/common';
import {
  ScenarioUsageQueryDto,
  ScenarioUsageResponseDto,
} from '../dto/scenario-usage-analytics.dto';
import { ScenarioUsageAnalyticsRepository } from '../repository/scenario-usage-analytics.repository';

/** Top/bottom N shown per list — enough to see a pattern, few enough to read at a glance. */
const SCENARIO_USAGE_LIMIT = 10;

@Injectable()
export class ScenarioUsageAnalyticsService {
  constructor(private readonly repository: ScenarioUsageAnalyticsRepository) {}

  async getScenarioUsage(
    query: ScenarioUsageQueryDto,
  ): Promise<ScenarioUsageResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const [mostUsed, leastUsed] = await Promise.all([
      this.repository.getMostUsed(SCENARIO_USAGE_LIMIT, tenantId),
      this.repository.getLeastUsed(SCENARIO_USAGE_LIMIT, tenantId),
    ]);

    return {
      mostUsed,
      leastUsed,
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
