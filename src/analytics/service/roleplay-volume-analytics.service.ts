import { Injectable } from '@nestjs/common';
import {
  MIN_ROLEPLAY_VOLUME_POPULATION,
  ROLEPLAY_VOLUME_BANDS,
  ROLEPLAY_VOLUME_ZERO_BAND_LABEL,
  RoleplayVolumeAnalyticsRepository,
} from '../repository/roleplay-volume-analytics.repository';
import {
  RoleplayVolumeQueryDto,
  RoleplayVolumeResponseDto,
} from '../dto/roleplay-volume-analytics.dto';

/**
 * Lifetime roleplay-volume distribution for the Highlights tab.
 *
 * Thin by design — the repository answers the question in one pass. What lives
 * here are the two rules that must not be left to a client:
 *
 *  - **The zero band is a residual, and it is derived once.** A learner who has
 *    never completed a roleplay has no session row, so their band can only be
 *    `registeredLearners - learnersWithAny`. Two clients deriving that separately
 *    is two chances to derive it differently; it is clamped at zero here so a data
 *    anomaly that put more active learners in scope than the population counting
 *    them shows up as an odd zero rather than as a negative bar.
 *  - **The floor for stating shares travels with the data.** The client is told
 *    the minimum population rather than hard-coding a second copy of it.
 */
@Injectable()
export class RoleplayVolumeAnalyticsService {
  constructor(private readonly repository: RoleplayVolumeAnalyticsRepository) {}

  async getRoleplayVolume(
    query: RoleplayVolumeQueryDto,
  ): Promise<RoleplayVolumeResponseDto> {
    const tenantId = query.tenantId?.trim() || undefined;

    const row = await this.repository.getLifetimeDistribution(tenantId);

    // The population can never be smaller than the people counted inside it.
    const registeredLearners = Math.max(
      row.registeredLearners,
      row.learnersWithAny,
    );

    return {
      bands: ROLEPLAY_VOLUME_BANDS.map((b) => ({ ...b })),
      zeroBandLabel: ROLEPLAY_VOLUME_ZERO_BAND_LABEL,
      minPopulationSize: MIN_ROLEPLAY_VOLUME_POPULATION,
      registeredLearners,
      learnersWithAny: row.learnersWithAny,
      learnersWithNone: Math.max(0, registeredLearners - row.learnersWithAny),
      learnersByBand: row.learnersByBand,
      totalCompletedRoleplays: row.totalCompleted,
      medianAmongActiveLearners: row.medianAmongActive,
      // Both the population (users) and the activity (scenario_sessions) carry a
      // tenant, so unlike AI cost or org counts there is nothing here that has to
      // stay platform-wide under a tenant filter.
      scoping: { tenantId: tenantId ?? null, unscopedSections: [] },
      computedAt: new Date().toISOString(),
    };
  }
}
